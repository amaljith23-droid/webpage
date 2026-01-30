import { useEffect, useRef } from "react";
import katex from "katex";

export default function Equation({
    latex,
    block = false,
}: { latex: string; block?: boolean }) {
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        if (!ref.current) return;
        try {
            katex.render(latex, ref.current, { throwOnError: false, displayMode: block });
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error("KaTeX render error:", e);
            ref.current.textContent = latex; // fallback: plain text
        }
    }, [latex, block]);
    return <span ref={ref} />;
}
