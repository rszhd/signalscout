import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";
import "./styles/theme.css";
import "./styles/monitor-setup.css";
import "./styles/connections.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("index.html is missing the #root element");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
