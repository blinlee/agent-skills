import { displaySourceTitle } from '../query/source-title.js';
export function buildRegistrySourceReadingPack(answerability, citations, results, passagesByCitation = registryPassagesByCitation(results), readingMode = 'passage') {
    const passages = dedupeRegistryPassages(citations.map((citation, index) => {
        const passage = passagesByCitation.get(registryCitationKey(citation));
        if (passage) {
            return {
                ...passage,
                citationIndex: index + 1,
                wikiId: citation.wikiId,
                wikiTitle: citation.wikiTitle,
            };
        }
        return {
            ...registryPassageFromCitation(citation, index),
            wikiId: citation.wikiId,
            wikiTitle: citation.wikiTitle,
        };
    }));
    const documents = readingMode === 'document' ? buildRegistrySourceDocuments(passages) : undefined;
    const pack = {
        answerability,
        readingMode,
        passageCount: passages.length,
        passages,
    };
    if (documents) {
        pack.documentCount = documents.length;
        pack.documents = documents;
    }
    return pack;
}
export function registryPassagesByCitation(results) {
    const map = new Map();
    for (const entry of results) {
        const result = entry.result;
        if (!result) {
            continue;
        }
        for (const passage of result.sourceReadingPack.passages) {
            const citation = result.citations[passage.citationIndex - 1];
            if (!citation) {
                continue;
            }
            map.set(registryCitationKey({ ...citation, wikiId: entry.wikiId }), passage);
        }
    }
    return map;
}
export function registryCitationKey(citation) {
    return citation.chunkId
        ? `${citation.wikiId}:chunk:${citation.chunkId}`
        : `${citation.wikiId}:source:${citation.sourceRef ?? citation.target}:${citation.startLine ?? ''}:${citation.endLine ?? ''}`;
}
function dedupeRegistryPassages(passages) {
    const seen = new Set();
    const deduped = [];
    for (const passage of passages) {
        const key = registryPassageDedupeKey(passage);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(passage);
    }
    return deduped;
}
function registryPassageDedupeKey(passage) {
    const normalizedText = passage.text.replace(/\s+/g, ' ').trim().slice(0, 400);
    return [
        passage.wikiId,
        passage.rawPath ?? passage.filePath,
        passage.sourceRef ?? '',
        passage.startLine ?? '',
        passage.endLine ?? '',
        normalizedText,
    ].join('|');
}
function buildRegistrySourceDocuments(passages) {
    const documents = new Map();
    for (const passage of passages) {
        const key = [
            passage.wikiId,
            passage.rawPath ?? passage.sourceRef ?? passage.filePath,
        ].join('|');
        const existing = documents.get(key);
        if (existing) {
            existing.selectedPassageIndexes.push(passage.citationIndex);
            continue;
        }
        documents.set(key, {
            documentIndex: documents.size + 1,
            wikiId: passage.wikiId,
            wikiTitle: passage.wikiTitle,
            sourceTitle: displaySourceTitle({
                title: passage.sourceTitle,
                sourceRef: passage.sourceRef,
                rawPath: passage.rawPath,
                filePath: passage.filePath,
            }),
            sourceRef: passage.sourceRef,
            rawPath: passage.rawPath ?? null,
            filePath: passage.rawPath ?? passage.filePath,
            evidenceKind: passage.evidenceKind,
            selectedPassageIndexes: [passage.citationIndex],
        });
    }
    return [...documents.values()];
}
function registryPassageFromCitation(citation, index) {
    const text = citation.excerpt;
    return {
        citationIndex: index + 1,
        wikiId: citation.wikiId,
        wikiTitle: citation.wikiTitle,
        sourceTitle: displaySourceTitle(citation),
        sourceRef: citation.sourceRef,
        rawPath: citation.rawPath ?? null,
        filePath: citation.rawPath ?? citation.filePath,
        evidenceKind: citation.evidenceKind,
        headingPath: citation.headingPath,
        heading: citation.heading,
        startLine: citation.startLine,
        endLine: citation.endLine,
        text,
        truncated: text.length >= 360,
        stitchedFromChunkIds: citation.chunkId ? [citation.chunkId] : [],
    };
}
