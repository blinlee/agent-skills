export function extractHeadings(content) {
    return content
        .split('\n')
        .map((line, index) => ({ line, index }))
        .map(({ line, index }) => ({ match: /^(#{1,6})\s+(.+?)\s*#*$/.exec(line), index }))
        .filter((entry) => entry.match !== null)
        .map(({ match, index }) => ({ level: match[1].length, text: match[2].trim(), lineIndex: index }));
}
export function buildHeadingPath(headings, lineIndex, fallback) {
    const stack = [];
    for (const heading of headings) {
        if (heading.lineIndex > lineIndex) {
            break;
        }
        while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
            stack.pop();
        }
        stack.push(heading);
    }
    return stack.length > 0 ? stack.map((heading) => heading.text) : [fallback];
}
