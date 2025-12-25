import { Routes, Route, Navigate } from "react-router-dom";
import { ClientPage } from "./pages/ClientPage";
import { AdminPage } from "./pages/AdminPage";
import { EditOrderPage } from "./pages/EditOrderPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ClientPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/edit/:code" element={<EditOrderPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
