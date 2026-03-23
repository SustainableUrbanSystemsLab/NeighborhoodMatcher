import { BrowserRouter, Routes, Route } from "react-router";
import Home from "@/pages/Home";
import Match from "@/pages/Match";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/match" element={<Match />} />
      </Routes>
    </BrowserRouter>
  );
}
