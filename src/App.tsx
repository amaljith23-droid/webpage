import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import SPP from "./pages/SPP";
import ThinFilm from "./pages/ThinFilm";
import EMTStack from "./pages/EMTStack";
import SkinDepth from "./pages/SkinDepth";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/spp" element={<SPP />} />
      <Route path="/thin-film" element={<ThinFilm />} />
      <Route path="/emt-stack" element={<EMTStack />} />
      <Route path="/skin-depth" element={<SkinDepth />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
