const STEPS = ['placed', 'packed', 'shipped', 'delivered'];

export default function OrderTracker({ status }) {
  if (status === 'cancelled') {
    return <span className="chip status bad"><i className="dot" /> Cancelled</span>;
  }
  if (status === 'pending_payment') {
    return <span className="chip status"><i className="dot" /> Awaiting payment</span>;
  }
  const current = STEPS.indexOf(status);
  return (
    <ol className="tracker" aria-label={`Order status: ${status}`}>
      {STEPS.map((s, i) => (
        <li key={s} className={i <= current ? 'done' : ''}>
          <span className="tdot" />
          {s}
        </li>
      ))}
    </ol>
  );
}