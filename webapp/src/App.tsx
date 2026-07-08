import { BrowserRouter, Routes, Route } from "react-router";
import Home from "@/pages/Home";
import Match from "@/pages/Match";
import About from "@/pages/About";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/match" element={<Match />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </BrowserRouter>
  );
}
