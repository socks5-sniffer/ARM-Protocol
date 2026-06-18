// SPDX-License-Identifier: Apache-2.0
import { C, f } from "../theme.js";

export function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: "0.58rem",
      letterSpacing: "0.2em",
      color: C.muted,
      textTransform: "uppercase",
      marginTop: "0.75rem",
      marginBottom: "0.25rem",
      fontFamily: f.mono,
    }}>
      {children}
    </div>
  );
}
