export type MarkdownHeading = {
  level: number
  text: string
  lineIndex: number
}

export function extractHeadings(content: string): MarkdownHeading[] {
  return content
    .split('\n')
    .map((line, index) => ({ line, index }))
    .map(({ line, index }) => ({ match: /^(#{1,6})\s+(.+?)\s*#*$/.exec(line), index }))
    .filter((entry): entry is { match: RegExpExecArray; index: number } => entry.match !== null)
    .map(({ match, index }) => ({ level: match[1]!.length, text: match[2]!.trim(), lineIndex: index }))
}

export function buildHeadingPath(
  headings: MarkdownHeading[],
  lineIndex: number,
  fallback: string,
): string[] {
  const stack: MarkdownHeading[] = []
  for (const heading of headings) {
    if (heading.lineIndex > lineIndex) {
      break
    }
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) {
      stack.pop()
    }
    stack.push(heading)
  }
  return stack.length > 0 ? stack.map((heading) => heading.text) : [fallback]
}
