import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import { Copy, Check } from '@phosphor-icons/react'

// If a code fence is opened but not closed (odd count of ``` at line start),
// append a closing fence so rehype-highlight never sees a partial block during
// streaming. Once the stream delivers the real close, the count becomes even and
// nothing is appended.
function patchStreamingMd(md: string): string {
  const opens = (md.match(/^```/gm) ?? []).length
  return opens % 2 !== 0 ? md + '\n```' : md
}

// Pre block with a header bar (language label + copy button).
// children is the <code> element rendered by react-markdown / rehype-highlight.
function PreBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  // rehype-highlight adds "hljs language-xxx" to the code element's className.
  const codeEl = Array.isArray(children) ? children[0] : children
  const rawClass = (codeEl as React.ReactElement<{ className?: string }>)?.props?.className ?? ''
  const lang = rawClass.split(' ').find((c: string) => c.startsWith('language-'))?.slice(9) ?? ''

  const copy = () => {
    navigator.clipboard.writeText(ref.current?.textContent ?? '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="code-block">
      <div className="code-block-head">
        {lang ? <span className="code-lang">{lang}</span> : <span />}
        <button className="code-copy" onClick={copy} title="Copier">
          {copied ? <Check size={12} weight="bold" /> : <Copy size={12} />}
        </button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  )
}

const MD_COMPONENTS: Components = {
  // Wrap every code block in our PreBlock (header + copy button).
  pre(props) {
    return <PreBlock>{props.children}</PreBlock>
  },
  // Open all links in the system browser via Electron's shell.openExternal —
  // never navigate the renderer itself.
  a(props) {
    const { href, children } = props
    const open = (e: React.MouseEvent) => {
      e.preventDefault()
      if (href && /^https?:\/\//.test(href)) {
        void window.api.shell.openExternal(href)
      }
    }
    return (
      <a href="#" onClick={open} className="md-link">
        {children}
      </a>
    )
  },
}

export function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // rehypeHighlight: no HTML sanitization needed here — HTML pass-through
        // is disabled by default in react-markdown (no rehype-raw), so raw
        // HTML in agent output is escaped, not injected.
        rehypePlugins={[rehypeHighlight]}
        components={MD_COMPONENTS}
      >
        {patchStreamingMd(text)}
      </ReactMarkdown>
    </div>
  )
}
