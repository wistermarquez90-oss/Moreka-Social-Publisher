import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Login from "./pages/Login"
import Recover from "./pages/Recover"
import NotFound from "./pages/NotFound"
import Editorial from "./pages/Editorial"
import Calendar from "./pages/Calendar"
import Settings from "./pages/Settings"
import CreatePublications from "./pages/CreatePublications"
import { Toaster } from "sonner"

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/crear" element={<CreatePublications />} />
        <Route path="/revision" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/recuperar" element={<Recover />} />
        <Route path="/editorial" element={<Editorial />} />
        <Route path="/calendario" element={<Calendar />} />
        <Route path="/configuracion" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster position="bottom-right" richColors />
    </>
  )
}
