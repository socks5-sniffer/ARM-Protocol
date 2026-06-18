// SPDX-License-Identifier: Apache-2.0
import { C, f } from "../theme.js";

export function Tag({ children, color = C.muted, bg }) {
  return (
    <span style={{
      display: "inline-block",
      background: bg || color + "18",
      color,
      border: `1px solid ${color}40`,
      borderRadius: "2px",
      fontSize: "0.58rem",
      padding: "0.1rem 0.35rem",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      marginRight: "0.25rem",
      marginBottom: "0.2rem",
      fontFamily: f.mono,
    }}>
      {children}
    </span>
  );
}
