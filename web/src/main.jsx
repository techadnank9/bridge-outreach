import { createRoot } from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "@designcodeio/threeui/style.css";
import "./app.css";
import { Theme } from "@astryxdesign/core/theme";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { App } from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <Theme theme={neutralTheme} mode="dark">
    <ToastViewport position="bottomEnd" maxVisible={3}>
      <App />
    </ToastViewport>
  </Theme>,
);
