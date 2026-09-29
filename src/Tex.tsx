import katex from 'katex';

export function Tex({ src, block = false }: { src: string; block?: boolean }) {
  const html = katex.renderToString(src, { displayMode: block, throwOnError: false });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
