import './App.css';
import { Routes, Route, Navigate } from 'react-router-dom';
import Listings from './pages/Listings';
import Part from './pages/Listing';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/listings" replace />} />
      <Route path="/listings" element={<Listings />} />
      <Route path="/listings/:id" element={<Part />} />
    </Routes>
  );
}

export default App;
