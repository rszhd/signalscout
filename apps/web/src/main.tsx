import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.js";
import "./index.css";
import "./styles/theme.css";
import "./styles/login.css";
import "./styles/billing.css";
import "./styles/models.css";
import "./styles/monitor-setup.css";
import "./styles/onboarding.css";
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
    {/*
      A real path router. US-076.

      Fastify hands `index.html` to any path that is not an API route or a
      file, and Vite does the same in development, so every address the app
      writes is one the server will serve on a refresh.
    */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
