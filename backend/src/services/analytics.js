const Order = require('../models/Order');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');
const User = require('../models/User');

const SALE = ['placed', 'packed', 'shipped', 'delivered']; // orders that count as sales
const money = (n) => Math.round(n * 100) / 100;
const DAY = 24 * 60 * 60 * 1000;
const IST = 5.5 * 60 * 60 * 1000;

// Calendar day in India (the admin's day, not UTC's), as YYYY-MM-DD.
const dayKey = (d) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);

// Sales numbers for the last `days` days, worked out in JS from the orders of that window.
// That is plenty for this project's size; a much bigger shop would move these sums into
// MongoDB aggregation pipelines.
async function buildAnalytics(days = 30) {
  const since = new Date(Date.now() - days * DAY);
  const orders = await Order.find({ createdAt: { $gte: since } })
    .select('vendor items total discount status createdAt payment')
    .lean();

  const sales = orders.filter((o) => SALE.includes(o.status));

  // One bucket per day, including days with no sales, so the chart has no gaps.
  const daily = new Map();
  for (let i = days - 1; i >= 0; i -= 1) daily.set(dayKey(Date.now() - i * DAY), { date: dayKey(Date.now() - i * DAY), orders: 0, revenue: 0, commission: 0 });

  const byVendor = new Map();
  const byProduct = new Map();
  const statusCounts = {};
  let gmv = 0;
  let commission = 0;
  let discounts = 0;
  let units = 0;
  let payoutsDue = 0;
  let refundsDue = 0;

  for (const o of orders) {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    if (o.payment?.status === 'refund_due') refundsDue += 1;
  }

  for (const o of sales) {
    const total = o.total || 0;
    const fee = o.payment?.commission || 0;
    gmv += total;
    commission += fee;
    discounts += o.discount || 0;

    const bucket = daily.get(dayKey(o.createdAt));
    if (bucket) {
      bucket.orders += 1;
      bucket.revenue += total;
      bucket.commission += fee;
    }

    // What we still owe the vendor: paid orders whose share has not been transferred to them.
    const due = o.payment?.status === 'paid' && o.payment?.transferStatus !== 'processed' ? o.payment?.vendorAmount || 0 : 0;
    payoutsDue += due;

    const vid = String(o.vendor);
    const v = byVendor.get(vid) || { vendorId: vid, orders: 0, revenue: 0, commission: 0, payoutDue: 0 };
    v.orders += 1;
    v.revenue += total;
    v.commission += fee;
    v.payoutDue += due;
    byVendor.set(vid, v);

    for (const i of o.items || []) {
      units += i.qty;
      const pid = String(i.product);
      const p = byProduct.get(pid) || { productId: pid, name: i.name, units: 0, revenue: 0 };
      p.units += i.qty;
      p.revenue += i.price * i.qty;
      byProduct.set(pid, p);
    }
  }

  const topVendors = [...byVendor.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const names = topVendors.length ? await Vendor.find({ _id: { $in: topVendors.map((v) => v.vendorId) } }).select('shopName').lean() : [];
  const nameOf = new Map(names.map((v) => [String(v._id), v.shopName]));

  const [vendors, products, customers] = await Promise.all([
    Vendor.countDocuments({ status: 'approved' }),
    Product.countDocuments({ isActive: true }),
    User.countDocuments({ role: 'customer' }),
  ]);

  return {
    days,
    since,
    totals: {
      gmv: money(gmv),
      orders: sales.length,
      avgOrderValue: sales.length ? money(gmv / sales.length) : 0,
      commission: money(commission),
      discounts: money(discounts),
      units,
      vendors,
      products,
      customers,
    },
    payouts: { due: money(payoutsDue), refundsDue },
    daily: [...daily.values()].map((d) => ({ ...d, revenue: money(d.revenue), commission: money(d.commission) })),
    statusCounts,
    topVendors: topVendors.map((v) => ({
      ...v,
      shopName: nameOf.get(v.vendorId) || 'Unknown shop',
      revenue: money(v.revenue),
      commission: money(v.commission),
      payoutDue: money(v.payoutDue),
    })),
    topProducts: [...byProduct.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((p) => ({ ...p, revenue: money(p.revenue) })),
  };
}

module.exports = { buildAnalytics };