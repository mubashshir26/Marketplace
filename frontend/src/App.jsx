import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import PageTransition from './components/PageTransition';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Search from './pages/Search';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';
import Checkout from './pages/CheckOut';
import Orders from './pages/Orders';
import VendorDashboard from './pages/VendorDashboard';
import AdminDashboard from './pages/AdminDashboard';

const customerOnly = (el) => <ProtectedRoute roles={['customer']}>{el}</ProtectedRoute>;

export default function App() {
  const location = useLocation();
  return (
    <MotionConfig reducedMotion="user">
      <div className="bg-glow" aria-hidden="true" />
      <Navbar />
      <main className="container">
        <PageTransition key={location.pathname}>
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/cart" element={customerOnly(<Cart />)} />
            <Route path="/checkout" element={customerOnly(<Checkout />)} />
            <Route path="/orders" element={customerOnly(<Orders />)} />
            <Route
              path="/vendor"
              element={<ProtectedRoute roles={['vendor', 'admin']}><VendorDashboard /></ProtectedRoute>}
            />
            <Route
              path="/admin"
              element={<ProtectedRoute roles={['admin']}><AdminDashboard /></ProtectedRoute>}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </PageTransition>
      </main>
    </MotionConfig>
  );
}