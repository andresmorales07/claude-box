import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { ComponentPropsWithoutRef } from "react";

// Register only the languages commonly seen in AI chat responses
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";

SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("md", markdown);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("yml", yaml);
SyntaxHighlighter.registerLanguage("docker", docker);
SyntaxHighlighter.registerLanguage("dockerfile", docker);

interface Props {
  children: string;
}

export function Markdown({ children }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children: codeChildren, ...props }: ComponentPropsWithoutRef<"code">) {
          const match = /language-(\w+)/.exec(className || "");
          const isInline = !match && !String(codeChildren).includes("\n");
          if (isInline) {
            return (
              <code className="px-1.5 py-0.5 rounded bg-secondary text-[0.8125rem] font-mono" {...props}>
                {codeChildren}
              </code>
            );
          }
          return (
            <SyntaxHighlighter
              style={oneDark}
              language={match?.[1] ?? "text"}
              PreTag="div"
              customStyle={{ margin: "0.5rem 0", borderRadius: "0.375rem", fontSize: "0.8125rem" }}
            >
              {String(codeChildren).replace(/\n$/, "")}
            </SyntaxHighlighter>
          );
        },
        pre({ children: preChildren }) {
          return <>{preChildren}</>;
        },
        p({ children: pChildren }) {
          return <p className="mb-2 last:mb-0 leading-relaxed">{pChildren}</p>;
        },
        ul({ children: ulChildren }) {
          return <ul className="mb-2 last:mb-0 pl-5 list-disc space-y-1">{ulChildren}</ul>;
        },
        ol({ children: olChildren }) {
          return <ol className="mb-2 last:mb-0 pl-5 list-decimal space-y-1">{olChildren}</ol>;
        },
        li({ children: liChildren }) {
          return <li className="leading-relaxed">{liChildren}</li>;
        },
        h1({ children: hChildren }) {
          return <h1 className="text-lg font-bold mb-2 mt-4 first:mt-0">{hChildren}</h1>;
        },
        h2({ children: hChildren }) {
          return <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{hChildren}</h2>;
        },
        h3({ children: hChildren }) {
          return <h3 className="text-sm font-bold mb-1.5 mt-2 first:mt-0">{hChildren}</h3>;
        },
        blockquote({ children: bqChildren }) {
          return <blockquote className="border-l-2 border-border pl-3 my-2 text-muted-foreground italic">{bqChildren}</blockquote>;
        },
        a({ href, children: aChildren }) {
          return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{aChildren}</a>;
        },
        table({ children: tChildren }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="w-full border-collapse text-sm">{tChildren}</table>
            </div>
          );
        },
        th({ children: thChildren }) {
          return <th className="border border-border px-3 py-1.5 text-left font-semibold bg-secondary">{thChildren}</th>;
        },
        td({ children: tdChildren }) {
          return <td className="border border-border px-3 py-1.5">{tdChildren}</td>;
        },
        hr() {
          return <hr className="my-3 border-border" />;
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
