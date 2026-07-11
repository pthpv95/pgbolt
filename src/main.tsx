import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { disableAutocorrect } from "./lib/disableAutocorrect";
import "./styles.css";

disableAutocorrect();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
