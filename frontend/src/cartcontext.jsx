import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from './AuthContext';

const EMPTY = { items: [], subtotal: 0, count: 0 };
const CartContext = createContext(null);

// Holds the shopper's cart (stored in Redis by the API) so the navbar badge,
// product cards and cart page all stay in sync.
export function CartProvider({ children }) {
  const { user } = useAuth();
  const isCustomer = user?.role === 'customer';
  const [cart, setCart] = useState(EMPTY);

  const refresh = useCallback(async () => {
    if (!isCustomer) {
      setCart(EMPTY);
      return;
    }
    try {
      setCart(await api('/cart'));
    } catch {
      /* the cart page shows errors for its own actions */
    }
  }, [isCustomer]);

  useEffect(() => { refresh(); }, [refresh]);

  const run = async (path, options) => {
    const next = await api(path, options);
    setCart(next);
    return next;
  };
  const add = (productId, qty = 1) => run('/cart/items', { method: 'POST', body: { productId, qty } });
  const setQty = (productId, qty) => run(`/cart/items/${productId}`, { method: 'PATCH', body: { qty } });
  const remove = (productId) => run(`/cart/items/${productId}`, { method: 'DELETE' });

  return (
    <CartContext.Provider value={{ cart, refresh, add, setQty, remove }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);