/**
 * ─── React Application Entry Point ───
 *
 * Mounts the root React component (<App />) into the DOM.
 * Uses StrictMode for development-time checks (effect double-invocation warnings, etc.).
 *
 * The HTML element with id="root" is defined in index.html.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
