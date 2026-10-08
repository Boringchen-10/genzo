import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AndroidApp from "./AndroidApp";
import "../styles.css";
import "../responsive-fixes.css";
import "../v1-1-1.css";
import "../explore.css";
import "../bookshelf.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到应用根节点");
document.documentElement.dataset.platform = "android";
createRoot(root).render(<StrictMode><AndroidApp /></StrictMode>);
