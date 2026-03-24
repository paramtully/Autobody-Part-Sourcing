import './App.css';
import { Routes, Route, ScrollRestoration} from 'react-router-dom';
import Listings from './pages/Listings';
import Part from './pages/Listing';

function App() {
  return (
    <>
      <Routes>
        <Route path="/listings" element={<Listings />} />
        <Route path="/listings/:id" element={<Part />} />
      </Routes>
      <ScrollRestoration />
    </>
  );
}

export default App;
