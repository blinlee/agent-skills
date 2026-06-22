export function buildTextWindows(text, windowChars, overlapChars) {
    if (windowChars <= 0) {
        throw new Error('windowChars must be greater than zero');
    }
    if (overlapChars < 0) {
        throw new Error('overlapChars must be zero or greater');
    }
    if (text.length <= windowChars) {
        return trimmedWindow(text, 0, text.length);
    }
    const windows = [];
    const step = Math.max(1, windowChars - overlapChars);
    for (let startOffset = 0; startOffset < text.length; startOffset += step) {
        const endOffset = Math.min(text.length, startOffset + windowChars);
        windows.push(...trimmedWindow(text, startOffset, endOffset));
        if (endOffset === text.length) {
            break;
        }
    }
    return windows;
}
export function buildSourceParentSpans(text, input) {
    if (input.parentWindowChars <= 0) {
        throw new Error('parentWindowChars must be greater than zero');
    }
    if (input.childWindowChars <= 0) {
        throw new Error('childWindowChars must be greater than zero');
    }
    const blocks = splitMarkdownBlocks(text);
    if (blocks.length === 0) {
        return buildTextWindows(text, input.childWindowChars, input.childOverlapChars)
            .map((window, index) => parentSpanFromWindow(text, window, 'window-fallback', [`fallback:${index + 1}`], input));
    }
    const spans = [];
    let group = [];
    for (const block of blocks) {
        if (block.text.length > input.parentWindowChars) {
            flushParentGroup(text, group, spans, input);
            group = [];
            for (const window of buildTextWindows(block.text, input.parentWindowChars, input.childOverlapChars)) {
                spans.push(parentSpanFromWindow(text, {
                    text: window.text,
                    startOffset: block.startOffset + window.startOffset,
                    endOffset: block.startOffset + window.endOffset,
                }, 'window-fallback', [block.ref], input));
            }
            continue;
        }
        const nextGroup = [...group, block];
        if (group.length > 0 && spanLength(text, nextGroup) > input.parentWindowChars) {
            flushParentGroup(text, group, spans, input);
            group = [block];
        }
        else {
            group = nextGroup;
        }
    }
    flushParentGroup(text, group, spans, input);
    return spans;
}
export function lineRangeForWindow(text, baseStartLine, startOffset, endOffset) {
    const startLine = baseStartLine + countNewlines(text.slice(0, startOffset));
    const endLine = baseStartLine + countNewlines(text.slice(0, Math.max(startOffset, endOffset - 1)));
    return { startLine, endLine };
}
function trimmedWindow(text, rawStartOffset, rawEndOffset) {
    let startOffset = rawStartOffset;
    let endOffset = rawEndOffset;
    while (startOffset < endOffset && /\s/.test(text[startOffset])) {
        startOffset += 1;
    }
    while (endOffset > startOffset && /\s/.test(text[endOffset - 1])) {
        endOffset -= 1;
    }
    if (startOffset >= endOffset) {
        return [];
    }
    return [{ text: text.slice(startOffset, endOffset), startOffset, endOffset }];
}
function countNewlines(text) {
    return text.split('\n').length - 1;
}
function splitMarkdownBlocks(text) {
    const lines = text.split('\n');
    const blocks = [];
    let offset = 0;
    let blockStart = null;
    let blockEnd = 0;
    let inFence = false;
    const closeBlock = () => {
        if (blockStart === null)
            return;
        const trimmed = trimOffsets(text, blockStart, blockEnd);
        if (trimmed.startOffset < trimmed.endOffset) {
            blocks.push({
                text: text.slice(trimmed.startOffset, trimmed.endOffset),
                startOffset: trimmed.startOffset,
                endOffset: trimmed.endOffset,
                ref: `block:${blocks.length + 1}`,
            });
        }
        blockStart = null;
        blockEnd = 0;
    };
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const lineStart = offset;
        const lineEnd = lineStart + line.length;
        const trimmedLine = line.trim();
        const fenceLine = trimmedLine.startsWith('```') || trimmedLine.startsWith('~~~');
        const blank = trimmedLine === '';
        if (fenceLine) {
            if (blockStart === null)
                blockStart = lineStart;
            blockEnd = lineEnd;
            inFence = !inFence;
        }
        else if (blank && !inFence) {
            closeBlock();
        }
        else {
            if (blockStart === null)
                blockStart = lineStart;
            blockEnd = lineEnd;
        }
        offset = lineEnd + (index < lines.length - 1 ? 1 : 0);
    }
    closeBlock();
    return blocks;
}
function flushParentGroup(sourceText, group, spans, input) {
    if (group.length === 0)
        return;
    const startOffset = group[0].startOffset;
    const endOffset = group.at(-1).endOffset;
    const trimmed = trimOffsets(sourceText, startOffset, endOffset);
    if (trimmed.startOffset >= trimmed.endOffset)
        return;
    const spanText = sourceText.slice(trimmed.startOffset, trimmed.endOffset);
    spans.push({
        text: spanText,
        startOffset: trimmed.startOffset,
        endOffset: trimmed.endOffset,
        splitStrategy: 'structure',
        sourceBlockRefs: group.map((block) => block.ref),
        childWindows: childWindowsForParent(spanText, trimmed.startOffset, input),
    });
}
function parentSpanFromWindow(sourceText, window, splitStrategy, sourceBlockRefs, input) {
    const trimmed = trimOffsets(sourceText, window.startOffset, window.endOffset);
    const spanText = sourceText.slice(trimmed.startOffset, trimmed.endOffset);
    return {
        text: spanText,
        startOffset: trimmed.startOffset,
        endOffset: trimmed.endOffset,
        splitStrategy,
        sourceBlockRefs,
        childWindows: childWindowsForParent(spanText, trimmed.startOffset, input),
    };
}
function childWindowsForParent(spanText, parentStartOffset, input) {
    return buildTextWindows(spanText, input.childWindowChars, input.childOverlapChars)
        .map((window) => ({
        text: window.text,
        startOffset: parentStartOffset + window.startOffset,
        endOffset: parentStartOffset + window.endOffset,
    }));
}
function spanLength(sourceText, blocks) {
    if (blocks.length === 0)
        return 0;
    return sourceText.slice(blocks[0].startOffset, blocks.at(-1).endOffset).length;
}
function trimOffsets(text, rawStartOffset, rawEndOffset) {
    let startOffset = rawStartOffset;
    let endOffset = rawEndOffset;
    while (startOffset < endOffset && /\s/.test(text[startOffset])) {
        startOffset += 1;
    }
    while (endOffset > startOffset && /\s/.test(text[endOffset - 1])) {
        endOffset -= 1;
    }
    return { startOffset, endOffset };
}
