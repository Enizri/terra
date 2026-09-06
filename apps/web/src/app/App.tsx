import { Navigate, Route, Routes } from "react-router-dom";
import TerraLanding from "../routes/landing/TerraLanding";
import Workspace from "../routes/workspace/Workspace";
import { HeroPixelField } from "../routes/landing/sections/HeroPixelField";
// Not from Workspace itself: minting a slug must not pull the whole route in.
import { randomSlug } from "../routes/workspace/slug";

/** /new mints a session slug once, then hands off to the workspace route. */
function NewSession() {
  return <Navigate replace to={`/new/s/${randomSlug()}`} />;
}

export default function App() {
  return (
    <>
      <HeroPixelField />
      <Routes>
        <Route path="/" element={<TerraLanding />} />
        <Route path="/new" element={<NewSession />} />
        <Route path="/new/s/:slug" element={<Workspace />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </>
  );
}
