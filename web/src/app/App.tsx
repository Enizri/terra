import { Navigate, Route, Routes } from "react-router-dom";
import TerraLanding from "../routes/landing/TerraLanding";
import Workspace, { randomSlug } from "../routes/workspace/Workspace";

/** /new mints a session slug once, then hands off to the workspace route. */
function NewSession() {
  return <Navigate replace to={`/new/s/${randomSlug()}`} />;
}

// Older landing experiments live in ./sections — kept for reference.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<TerraLanding />} />
      <Route path="/new" element={<NewSession />} />
      <Route path="/new/s/:slug" element={<Workspace />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
