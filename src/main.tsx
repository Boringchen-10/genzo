import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AndroidPrototype from "./android/AndroidPrototype";
import "./styles.css";
import "./responsive-fixes.css";
import "./v1-1-1.css";
import "./explore.css";
import "./bookshelf.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到应用根节点");
const isAndroid = /Android/i.test(navigator.userAgent);
if (isAndroid) document.documentElement.dataset.platform = "android";

createRoot(root).render(
  <StrictMode>
    {isAndroid ? <AndroidPrototype /> : <App />}
  </StrictMode>,
);
