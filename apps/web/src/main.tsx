import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";
import "./styles/theme.css";
import "./styles/monitor-setup.css";
import "./styles/connections.css";
import "./styles/projects.css";
import "./styles/monitors.css";
import "./styles/providers.css";
import "./styles/reply-draft.css";
import "./styles/reply-voices.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("index.html is missing the #root element");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
