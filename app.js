(() => {
  const PDFJS_MODULE_URL = './vendor/pdfjs/build/pdf.min.mjs';
  const PDFJS_ASSET_ROOT = new URL('./vendor/pdfjs/', document.baseURI).href;
  const CROSSREF_API_URL = 'https://api.crossref.org/works';
  const CROSSREF_FIELDS = 'DOI,title,author,published,issued,container-title,abstract,URL,volume,issue,page,publisher,type';
  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const STATUS_LABELS = {
    'needs-review': 'Needs review',
    'partly-supported': 'Partly supported',
    supported: 'Supported',
    unsupported: 'Unsupported',
    contradictory: 'Contradictory',
    outdated: 'Possibly outdated'
  };
  const sampleClaim = {
    id: 'illustrative-claim',
    text: 'A particular study found that a learning app improved test scores by 30%.',
    citations: [{ label: 'Illustrative cited paper', reference: '', url: '' }],
    status: 'partly-supported',
    evidence: 'The challenge brief says its illustrative paper reports improvement in a small pilot group, but does not report a 30% increase.',
    evidenceSource: 'CiteVerify problem statement · illustrative example',
    illustrative: true,
    humanReviewed: false
  };

  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const documentName = document.getElementById('document-name');
  const documentText = document.getElementById('document-text');
  const analyzeButton = document.getElementById('analyze-button');
  const sampleButton = document.getElementById('sample-button');
  const claimList = document.getElementById('claim-list');
  const claimDetail = document.getElementById('claim-detail');
  const statusFilter = document.getElementById('status-filter');
  const emptyFilter = document.getElementById('empty-filter');
  const toast = document.getElementById('toast');
  const exportButton = document.getElementById('export-button');
  const printReport = document.getElementById('print-report');

  let claims = [{ ...sampleClaim }];
  let selectedClaimId = sampleClaim.id;
  let activeDocument = 'Illustrative example';
  let toastTimer = 0;
  let pdfLibraryPromise = null;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  function escapeText(value) {
    return String(value || '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function getStatusLabel(status) {
    return STATUS_LABELS[status] || STATUS_LABELS['needs-review'];
  }

  function getStatusClass(status) {
    return `status-${STATUS_LABELS[status] ? status : 'needs-review'}`;
  }

  function makeStatusPill(status) {
    const pill = document.createElement('span');
    pill.className = `status-pill ${getStatusClass(status)}`;
    pill.textContent = getStatusLabel(status);
    return pill;
  }

  function getSelectedClaim() {
    return claims.find((claim) => claim.id === selectedClaimId) || claims[0] || null;
  }

  function renderMetrics() {
    const detectedCitations = claims.reduce((total, claim) => total + claim.citations.length, 0);
    const needsReview = claims.filter((claim) => !claim.humanReviewed).length;
    document.getElementById('metric-claims').textContent = String(claims.length);
    document.getElementById('metric-citations').textContent = String(detectedCitations);
    document.getElementById('metric-review').textContent = String(needsReview);
    document.getElementById('claim-count-label').textContent = `(${claims.length})`;
  }

  function renderClaimList() {
    claimList.replaceChildren();
    const filteredClaims = claims.filter((claim) => statusFilter.value === 'all' || claim.status === statusFilter.value);
    emptyFilter.hidden = filteredClaims.length > 0;

    for (const claim of filteredClaims) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'claim-list-item';
      item.setAttribute('aria-current', String(claim.id === selectedClaimId));

      const text = document.createElement('p');
      text.textContent = claim.text;
      const meta = document.createElement('span');
      meta.className = 'claim-list-meta';
      meta.append(makeStatusPill(claim.status));
      const citationCount = document.createElement('span');
      citationCount.textContent = `${claim.citations.length} citation${claim.citations.length === 1 ? '' : 's'}`;
      meta.append(citationCount);
      item.append(text, meta);
      item.addEventListener('click', () => {
        selectedClaimId = claim.id;
        render();
      });
      claimList.append(item);
    }
  }

  function createSourceContent(citations) {
    const content = document.createDocumentFragment();
    if (!citations.length) {
      content.append(document.createTextNode('No citation was detected next to this claim. Check the surrounding paragraph and reference list.'));
      return content;
    }

    citations.forEach((citation, index) => {
      const citationEntry = document.createElement('div');
      citationEntry.className = 'citation-entry';
      const citationLine = document.createElement('div');
      citationLine.className = 'citation-line';
      const label = document.createElement('strong');
      label.textContent = citation.label;
      citationLine.append(label);
      if (citation.reference) {
        const reference = document.createElement('span');
        reference.textContent = citation.reference;
        citationLine.append(reference);
      }
      citationEntry.append(citationLine);
      if (citation.lookup) citationEntry.append(renderCitationLookup(citation.lookup));
      const searchButton = document.createElement('button');
      searchButton.className = 'source-search-button';
      searchButton.type = 'button';
      searchButton.disabled = citation.lookup?.state === 'loading';
      searchButton.textContent = citation.lookup?.state === 'loading'
        ? 'Searching Crossref…'
        : citation.lookup?.state === 'loaded' ? 'Refresh publication record'
          : citation.lookup?.state === 'error' ? 'Retry Crossref search' : 'Find publication in Crossref';
      searchButton.addEventListener('click', () => searchCitation(citation));
      citationEntry.append(searchButton);
      content.append(citationEntry);
      if (index < citations.length - 1) {
        const divider = document.createElement('div');
        divider.className = 'citation-divider';
        content.append(divider);
      }
    });
    return content;
  }

  function getPublicationYear(work) {
    const dateParts = work.published?.['date-parts'] || work['published-print']?.['date-parts'] || work.issued?.['date-parts'];
    return dateParts?.[0]?.[0] ? String(dateParts[0][0]) : '';
  }

  function getPublicationAuthors(work) {
    return (work.author || [])
      .slice(0, 3)
      .map((author) => [author.given, author.family].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(', ');
  }

  function getPublicationAbstract(work) {
    if (!work.abstract) return '';
    return new DOMParser()
      .parseFromString(`<body>${work.abstract}</body>`, 'text/html')
      .body.textContent
      .replace(/\s+/g, ' ')
      .trim();
  }

  function makeDoiUrl(doi) {
    return `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`;
  }

  function renderCitationLookup(lookup) {
    const panel = document.createElement('div');
    panel.className = 'source-results';
    const heading = document.createElement('p');
    heading.className = 'source-results-heading';
    heading.textContent = lookup.exactDoi
      ? 'Crossref publication record'
      : 'Crossref search results · confirm the match';
    panel.append(heading);

    if (lookup.error) {
      const error = document.createElement('p');
      error.className = 'source-search-error';
      error.textContent = lookup.error;
      panel.append(error);
      return panel;
    }

    if (!lookup.works.length) {
      const empty = document.createElement('p');
      empty.className = 'source-search-error';
      empty.textContent = 'Crossref found no record for this citation. Check the reference or try another search.';
      panel.append(empty);
      return panel;
    }

    for (const work of lookup.works) {
      const result = document.createElement('article');
      result.className = 'source-result';
      const title = document.createElement('h5');
      title.textContent = work.title?.[0] || 'Untitled publication';
      result.append(title);
      const metadata = [getPublicationAuthors(work), getPublicationYear(work), work['container-title']?.[0]]
        .filter(Boolean)
        .join(' · ');
      if (metadata) {
        const metadataLine = document.createElement('p');
        metadataLine.className = 'source-result-meta';
        metadataLine.textContent = metadata;
        result.append(metadataLine);
      }
      if (work.DOI) {
        const sourceLink = document.createElement('a');
        sourceLink.className = 'citation-link';
        sourceLink.href = makeDoiUrl(work.DOI);
        sourceLink.target = '_blank';
        sourceLink.rel = 'noopener noreferrer';
        sourceLink.textContent = `Open publication · DOI ${work.DOI}`;
        result.append(sourceLink);
      }
      const abstract = getPublicationAbstract(work);
      if (abstract) {
        const abstractDetails = document.createElement('details');
        abstractDetails.className = 'source-abstract';
        const abstractSummary = document.createElement('summary');
        abstractSummary.textContent = 'Read publisher abstract';
        const abstractText = document.createElement('p');
        abstractText.className = 'source-result-abstract';
        abstractText.textContent = abstract;
        abstractDetails.append(abstractSummary, abstractText);
        result.append(abstractDetails);
      } else {
        const evidence = document.createElement('p');
        evidence.className = 'source-result-abstract';
        evidence.textContent = 'No abstract was provided in the Crossref record. Open the publication to inspect the source.';
        result.append(evidence);
      }
      panel.append(result);
    }
    return panel;
  }

  function getCitationDoi(citation) {
    const fromReference = citation.reference.match(/\b10\.\d{4,9}\/[^\s<>"'{}|\\^`]+/i);
    const fromUrl = citation.url.match(/doi\.org\/([^?#]+)/i);
    return (fromReference?.[0] || (fromUrl ? decodeURIComponent(fromUrl[1]) : '')).replace(/[.,;]+$/, '');
  }

  async function searchCitation(citation) {
    if (citation.lookup?.state === 'loading') return;
    citation.lookup = { state: 'loading', works: [], exactDoi: Boolean(getCitationDoi(citation)), error: '' };
    render();
    try {
      const doi = getCitationDoi(citation);
      const parameters = new URLSearchParams({
        rows: doi ? '1' : '5',
        select: CROSSREF_FIELDS
      });
      if (doi) parameters.set('filter', `doi:${doi}`);
      else parameters.set('query.bibliographic', citation.reference || citation.label);
      const response = await fetch(`${CROSSREF_API_URL}?${parameters.toString()}`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`Crossref returned ${response.status}.`);
      const data = await response.json();
      citation.lookup = {
        state: 'loaded',
        works: data.message?.items || [],
        exactDoi: Boolean(doi),
        error: ''
      };
    } catch (error) {
      console.error('Could not search Crossref for the citation.', error);
      citation.lookup = {
        state: 'error',
        works: [],
        exactDoi: Boolean(getCitationDoi(citation)),
        error: error instanceof Error ? `${error.message} Check your internet connection and try again.` : 'Crossref search failed. Check your internet connection and try again.'
      };
    }
    render();
  }

  function renderClaimDetail() {
    const claim = getSelectedClaim();
    if (!claim) {
      claimDetail.innerHTML = activeDocument === 'Illustrative example'
        ? '<div class="detail-topline"><span class="detail-label">NO CLAIMS TO REVIEW</span></div><h4>Upload or paste an academic document to get started.</h4><p class="evidence-box">CiteVerify identifies claim-like statements and citation markers in your text.</p>'
        : '<div class="detail-topline"><span class="detail-label">NO CLAIMS DETECTED</span></div><h4>No claim-like statements found in this document.</h4><p class="evidence-box">Try a passage with a research finding, result, measured value, or citation. Extraction is heuristic, so review the document text if an important claim was missed.</p>';
      return;
    }

    const citationExplanation = claim.illustrative
      ? 'This is an illustrative scenario from the challenge brief, not an identified publication.'
      : claim.citations.some((citation) => citation.reference)
        ? 'Reference text was matched inside your document. The cited publication has not been independently retrieved.'
        : 'No matching reference entry was found in the document. Confirm the citation and source manually.';
    const evidence = claim.evidence || (claim.citations.length
      ? 'The citation appears in the document, but the original paper has not been retrieved. Compare the claim with the source’s findings, population, methods, and limitations before assigning a verdict.'
      : 'No citation was detected for this statement. Add a source or review whether this claim needs one.');
    const evidenceSource = claim.evidenceSource || (claim.citations.some((citation) => citation.reference)
      ? 'Document reference list · source evidence not fetched'
      : 'No source passage available');

    claimDetail.replaceChildren();
    const topLine = document.createElement('div');
    topLine.className = 'detail-topline';
    const label = document.createElement('span');
    label.className = 'detail-label';
    label.textContent = `CLAIM ${String(claims.indexOf(claim) + 1).padStart(2, '0')}`;
    topLine.append(label, makeStatusPill(claim.status));
    const confidenceLabel = document.createElement('span');
    confidenceLabel.className = 'confidence-label';
    confidenceLabel.textContent = 'Evidence confidence · not assessed';
    topLine.append(confidenceLabel);
    if (claim.illustrative) {
      const sampleLabel = document.createElement('span');
      sampleLabel.className = 'illustrative-label';
      sampleLabel.textContent = 'Illustrative from brief';
      topLine.append(sampleLabel);
    }
    const claimText = document.createElement('h4');
    claimText.textContent = claim.text;
    claimDetail.append(topLine, claimText);

    const citationBlock = document.createElement('div');
    citationBlock.className = 'detail-block';
    citationBlock.innerHTML = '<p class="detail-block-label"><span aria-hidden="true">↗</span> CITATION &amp; MATCH</p>';
    const citationBox = document.createElement('div');
    citationBox.className = 'citation-box';
    citationBox.append(createSourceContent(claim.citations));
    const citationNote = document.createElement('span');
    citationNote.className = 'evidence-source';
    citationNote.textContent = citationExplanation;
    citationBox.append(citationNote);
    citationBlock.append(citationBox);

    const evidenceBlock = document.createElement('div');
    evidenceBlock.className = 'detail-block';
    evidenceBlock.innerHTML = '<p class="detail-block-label"><span aria-hidden="true">⌕</span> EVIDENCE &amp; CONTEXT</p>';
    const evidenceBox = document.createElement('div');
    evidenceBox.className = 'evidence-box';
    evidenceBox.textContent = evidence;
    const source = document.createElement('span');
    source.className = 'evidence-source';
    source.textContent = evidenceSource;
    evidenceBox.append(source);
    evidenceBlock.append(evidenceBox);

    const review = document.createElement('div');
    review.className = 'detail-review';
    const selectLabel = document.createElement('label');
    selectLabel.className = 'review-select-label';
    selectLabel.htmlFor = 'review-verdict';
    selectLabel.textContent = 'Human review verdict';
    const select = document.createElement('select');
    select.id = 'review-verdict';
    select.className = 'review-select';
    Object.entries(STATUS_LABELS).forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === claim.status;
      select.append(option);
    });
    const selectWrap = document.createElement('div');
    selectWrap.append(selectLabel, select);
    const saveButton = document.createElement('button');
    saveButton.className = 'save-review-button';
    saveButton.type = 'button';
    saveButton.textContent = 'Save review';
    saveButton.addEventListener('click', () => {
      claim.status = select.value;
      claim.humanReviewed = true;
      render();
      showToast('Human review saved in this browser session.');
    });
    review.append(selectWrap, saveButton);

    const reviewState = document.createElement('p');
    reviewState.className = 'review-state';
    reviewState.textContent = claim.humanReviewed
      ? 'Human-reviewed · changes are kept in this browser session.'
      : 'Not yet human-reviewed · an automated label is not a conclusion.';
    claimDetail.append(citationBlock, evidenceBlock, review, reviewState);
  }

  function renderReportSummary() {
    const summary = document.getElementById('report-summary-text');
    const needsReview = claims.filter((claim) => !claim.humanReviewed).length;
    if (activeDocument === 'Illustrative example') {
      summary.textContent = 'One illustrative claim from the challenge brief. Its example highlights why matching a citation is not the same as verifying the evidence.';
    } else if (claims.length === 0) {
      summary.textContent = 'No claim-like statements were identified. Try adding a longer passage with citations or factual findings.';
    } else {
      summary.textContent = `${claims.length} claim${claims.length === 1 ? '' : 's'} identified. ${needsReview} still ${needsReview === 1 ? 'needs' : 'need'} human review; source support has not been independently verified.`;
    }
    const summaryLabel = document.querySelector('.summary-label');
    summaryLabel.innerHTML = `<span class="summary-dot"></span> ${needsReview ? 'REVIEW REQUIRED' : 'HUMAN REVIEWED'}`;
  }

  function render() {
    renderMetrics();
    renderClaimList();
    renderClaimDetail();
    renderReportSummary();
  }

  function extractReferences(text) {
    const heading = /(?:^|\n)[ \t]*(?:references|bibliography|works cited|literature cited|reference list)[ \t]*:?[ \t]*(?=\n|$)/i;
    const match = heading.exec(text);
    if (!match) return { body: text, references: [] };
    const body = text.slice(0, match.index);
    const referenceText = text.slice(match.index + match[0].length);
    const lines = referenceText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const references = [];
    for (const line of lines) {
      const numbered = line.match(/^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+(.+)$/);
      if (numbered) {
        references.push({ number: numbered[1] || numbered[2], text: numbered[3] });
      } else if (references.length === 0 || /^[A-Z][A-Za-z'’.-]+,\s/.test(line)) {
        references.push({ number: '', text: line });
      } else if (references.length) {
        references[references.length - 1].text += ` ${line}`;
      }
    }
    return { body, references };
  }

  function referenceUrl(reference) {
    const doi = reference.match(/\b10\.\d{4,9}\/[^\s<>"'{}|\\^`]+/i);
    if (doi) return `https://doi.org/${doi[0].replace(/[.,;]+$/, '')}`;
    const url = reference.match(/https?:\/\/[^\s<>"']+/i);
    return url ? url[0].replace(/[.,;]+$/, '') : '';
  }

  function getCitations(sentence, references) {
    const citations = [];
    const numericMatches = sentence.matchAll(/\[([\d\s,;–-]+)\]|\(([\d\s,;–-]+)\)/g);
    for (const match of numericMatches) {
      const numbers = (match[1] || match[2]).match(/\d+/g) || [];
      for (const number of numbers) {
        const reference = references.find((item) => item.number === number);
        if (!match[1] && !reference) continue;
        citations.push({
          label: match[1] ? `[${number}]` : `(${number})`,
          reference: reference ? reference.text : '',
          url: reference ? referenceUrl(reference.text) : ''
        });
      }
    }
    const authorYearMatches = sentence.matchAll(/[\[(]([^()[\]]{0,90}\b(?:19|20)\d{2}[a-z]?[^()[\]]*)[\])]/gi);
    for (const match of authorYearMatches) {
      const label = match[1].trim();
      if (/^(?:19|20)\d{2}[a-z]?$/i.test(label)) continue;
      const firstAuthor = label.match(/[A-Z][A-Za-z'-]+/);
      const year = label.match(/\b(?:19|20)\d{2}[a-z]?\b/i);
      const reference = references.find((item) => {
        const normalized = item.text.toLowerCase();
        const authorMatches = !firstAuthor || new RegExp(`\\b${firstAuthor[0]}\\b`, 'i').test(normalized);
        const yearMatches = !year || new RegExp(`\\b${year[0]}\\b`, 'i').test(normalized);
        return (firstAuthor || year) && authorMatches && yearMatches;
      });
      citations.push({
        label,
        reference: reference ? reference.text : '',
        url: reference ? referenceUrl(reference.text) : ''
      });
    }
    return citations.filter((citation, index, list) => (
      list.findIndex((other) => other.label === citation.label && other.reference === citation.reference) === index
    ));
  }

  function isClaimLike(sentence) {
    const clean = sentence.replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, '').trim();
    if (clean.length < 24 || clean.split(/\s+/).length < 4 || /\?\s*$/.test(clean)) return false;
    if (/^(?:abstract|introduction|background|methods?|results?|discussion|conclusion|references|acknowledg(?:e)?ments|keywords)\b/i.test(clean)) return false;
    const citation = getCitations(clean, []);
    const scientificSignal = /\b(?:found|show(?:s|ed|n)?|demonstrat(?:e|es|ed)|report(?:s|ed)|indicat(?:e|es|ed)|suggest(?:s|ed)|increase[ds]?|decrease[ds]?|improv(?:e|es|ed)|reduc(?:e|es|ed)|associat(?:e|es|ed)|link(?:s|ed)?|caus(?:e|es|ed)|predict(?:s|ed)?|correlat(?:e|es|ed)|conclud(?:e|es|ed)|support(?:s|ed)?|outperform(?:s|ed)?|exceed(?:s|ed)?|lead(?:s)?|led|result(?:s|ed)?|affect(?:s|ed)?|impact(?:s|ed)?|higher|lower|greater|significant(?:ly)?|effective|ineffective|risk of|more likely)\b/i.test(clean);
    const quantitativeSignal = /\b\d+(?:[.,]\d+)?\s*(?:%|percent\b|patients?\b|participants?\b|subjects?\b|cases?\b|years?\b|months?\b|weeks?\b|days?\b|mg\b|kg\b|cm\b|mm\b|°c\b|degrees?\b)/i.test(clean);
    return citation.length > 0 || scientificSignal || quantitativeSignal;
  }

  function splitSentences(paragraph) {
    if (typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
      return Array.from(segmenter.segment(paragraph), (segment) => segment.segment);
    }
    return paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/);
  }

  function isSectionHeading(line) {
    return /^(?:abstract|introduction|background|literature review|related work|methods?|materials and methods|results?|discussion|conclusion|references|bibliography|works cited|acknowledg(?:e)?ments|keywords)\s*:?\s*$/i.test(line.trim());
  }

  function analyzeDocument(text) {
    const normalized = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
    if (!normalized) {
      showToast('Add document text or choose a file before analyzing.');
      return;
    }
    const { body, references } = extractReferences(normalized);
    const paragraphs = body.split(/\n\s*\n/).map((paragraph) => (
      paragraph.split(/\n+/).filter((line) => !isSectionHeading(line)).join(' ')
    ));
    const sentences = paragraphs
      .flatMap(splitSentences)
      .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const candidates = sentences.filter(isClaimLike);
    const seen = new Set();
    claims = candidates
      .filter((sentence) => {
        const normalizedSentence = sentence.toLowerCase();
        if (seen.has(normalizedSentence)) return false;
        seen.add(normalizedSentence);
        return true;
      })
      .slice(0, 100)
      .map((sentence, index) => ({
        id: `claim-${index + 1}`,
        text: sentence,
        citations: getCitations(sentence, references),
        status: 'needs-review',
        evidence: '',
        evidenceSource: '',
        illustrative: false,
        humanReviewed: false
      }));
    selectedClaimId = claims.length ? claims[0].id : '';
    documentName.textContent = activeDocument;
    render();
    showToast(`${claims.length} claim${claims.length === 1 ? '' : 's'} identified in your document.`);
  }

  function loadPdfLibrary() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfLibraryPromise) return pdfLibraryPromise;
    pdfLibraryPromise = import(PDFJS_MODULE_URL).then((pdfjs) => {
      window.pdfjsLib = pdfjs;
      return pdfjs;
    }).catch((error) => {
      pdfLibraryPromise = null;
      throw error;
    });
    return pdfLibraryPromise;
  }

  async function extractPdfText(file) {
    const pdfjs = await loadPdfLibrary();
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSET_ROOT}build/pdf.worker.min.mjs`;
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({
      data,
      cMapUrl: `${PDFJS_ASSET_ROOT}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_ASSET_ROOT}standard_fonts/`
    }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = [];
      let line = '';
      let previousBaseline = null;
      const finishLine = () => {
        if (line.trim()) lines.push(line.trim());
        line = '';
      };
      for (const item of content.items) {
        const value = item.str || '';
        const baseline = item.transform && item.transform[5];
        if (line && Number.isFinite(baseline) && Number.isFinite(previousBaseline)
          && Math.abs(baseline - previousBaseline) > 5) {
          finishLine();
        }
        if (line && value && !/\s$/.test(line) && !/^[,.;:!?%)\]}]/.test(value) && !/[\[({/]$/.test(line)) {
          line += ' ';
        }
        line += value;
        if (item.hasEOL) finishLine();
        previousBaseline = Number.isFinite(baseline) ? baseline : previousBaseline;
      }
      finishLine();
      pages.push(lines.join('\n'));
    }
    return pages.join('\n\n');
  }

  async function handleFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      showToast('This file is larger than 20 MB. Choose a smaller document.');
      return;
    }
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'txt', 'md', 'csv'].includes(extension)) {
      showToast('Choose a PDF, TXT, MD, or CSV document.');
      return;
    }
    documentName.textContent = `Reading ${file.name}…`;
    try {
      const text = extension === 'pdf'
        ? await extractPdfText(file)
        : await file.text();
      if (!text.trim()) {
        documentName.textContent = file.name;
        showToast('No selectable text found. Try a text-based PDF or paste the document text.');
        return;
      }
      activeDocument = file.name;
      documentName.textContent = file.name;
      documentText.value = text;
      analyzeDocument(text);
    } catch (error) {
      console.error('Could not read the selected document.', error);
      documentName.textContent = 'Could not read document';
      showToast(extension === 'pdf'
        ? 'Could not read this PDF. Check your connection for the PDF reader, or paste its text instead.'
        : 'Could not read this file. Try another document or paste its text.');
    } finally {
      fileInput.value = '';
    }
  }

  function loadSample() {
    claims = [{ ...sampleClaim, citations: sampleClaim.citations.map((citation) => ({ ...citation })) }];
    selectedClaimId = sampleClaim.id;
    activeDocument = 'Illustrative example';
    documentName.textContent = activeDocument;
    documentText.value = '';
    statusFilter.value = 'all';
    render();
    showToast('Loaded the illustrative example from the CiteVerify problem statement.');
  }

  function exportReport() {
    const reportDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
    const claimsHtml = claims.length
      ? claims.map((claim, index) => {
        const citationsHtml = claim.citations.length
          ? claim.citations.map((citation) => {
            const lookupHtml = citation.lookup?.works.map((work) => {
              const details = [
                getPublicationAuthors(work),
                getPublicationYear(work),
                work['container-title']?.[0]
              ].filter(Boolean).map(escapeText).join(' · ');
              const abstract = getPublicationAbstract(work);
              const doiLink = work.DOI
                ? `<a href="${escapeText(makeDoiUrl(work.DOI))}">https://doi.org/${escapeText(work.DOI)}</a>`
                : '';
              return `<div class="source">
                <h4>${escapeText(work.title?.[0] || 'Untitled publication')}</h4>
                ${details ? `<p>${details}</p>` : ''}
                ${doiLink ? `<p>${doiLink}</p>` : ''}
                ${abstract ? `<p><strong>Publisher abstract:</strong> ${escapeText(abstract)}</p>` : '<p>No publisher abstract was available in the Crossref record.</p>'}
              </div>`;
            }).join('') || '';
            const searchMessage = citation.lookup?.error
              ? `<p class="note">${escapeText(citation.lookup.error)}</p>`
              : citation.lookup?.state === 'loaded' && citation.lookup.works.length === 0
                ? '<p class="note">Crossref found no record for this citation.</p>'
                : '';
            return `<div class="citation">
              <p><strong>${escapeText(citation.label)}</strong>${citation.reference ? ` — ${escapeText(citation.reference)}` : ''}</p>
              ${lookupHtml}${searchMessage}
            </div>`;
          }).join('')
          : '<p>No citation was detected next to this claim.</p>';
        const evidence = claim.evidence || (claim.citations.length
          ? 'The citation appears in the document, but source support has not been assessed. Compare the claim with the publication’s findings, population, methods, and limitations.'
          : 'No citation was detected for this statement. Add a source or review whether this claim needs one.');
        return `<article class="claim">
          <div class="claim-heading">
            <h2>Claim ${String(index + 1).padStart(2, '0')}</h2>
            <span class="verdict">${escapeText(getStatusLabel(claim.status))}</span>
          </div>
          <blockquote>${escapeText(claim.text)}</blockquote>
          <h3>Citation and source</h3>
          ${citationsHtml}
          <h3>Evidence and context</h3>
          <p>${escapeText(evidence)}</p>
          ${claim.evidenceSource ? `<p class="note">${escapeText(claim.evidenceSource)}</p>` : ''}
          <p class="review">${claim.humanReviewed
            ? 'Human reviewed — verdict recorded in this session.'
            : 'Needs human review — automated extraction is not a scientific verdict.'}</p>
        </article>`;
      }).join('')
      : '<p>No claim-like statements were identified in this document.</p>';
    const summary = activeDocument === 'Illustrative example'
      ? 'Illustrative example from the CiteVerify problem statement. This is not an independently verified scientific claim.'
      : `${claims.length} claim${claims.length === 1 ? '' : 's'} identified. Publication records and abstracts are provided for review; the app does not decide whether a source supports a claim.`;
    printReport.innerHTML = `
      <header class="print-report-header">
        <p class="print-report-brand">CiteVerify · Research integrity</p>
        <h1>Claim Verification Report</h1>
        <p><strong>Document:</strong> ${escapeText(activeDocument)}</p>
        <p><strong>Generated:</strong> ${escapeText(reportDate)}</p>
      </header>
      <div class="print-report-notice"><strong>Review responsibly.</strong> ${escapeText(summary)} Citation matching and publisher abstracts are source references—not proof that a claim is supported. Every verdict needs human review.</div>
      <main>${claimsHtml}</main>
      <footer>Generated by CiteVerify. Document text is processed in your browser. Source lookups are user-triggered via Crossref. Original paper context and human judgment are required for an academic conclusion.</footer>`;
    printReport.hidden = false;
    const previousTitle = document.title;
    document.title = `CiteVerify Verification Report - ${activeDocument}`;
    window.addEventListener('afterprint', () => {
      printReport.hidden = true;
      document.title = previousTitle;
    }, { once: true });
    showToast('Print dialog opened. Choose “Save as PDF” to download the report.');
    window.print();
  }

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-dragging');
    });
  }
  dropZone.addEventListener('drop', (event) => handleFile(event.dataTransfer.files[0]));
  analyzeButton.addEventListener('click', () => {
    activeDocument = documentText.value.trim() ? 'Pasted document' : activeDocument;
    analyzeDocument(documentText.value);
  });
  sampleButton.addEventListener('click', loadSample);
  statusFilter.addEventListener('change', () => {
    const visibleClaim = claims.find((claim) => statusFilter.value === 'all' || claim.status === statusFilter.value);
    selectedClaimId = visibleClaim ? visibleClaim.id : '';
    render();
  });
  exportButton.addEventListener('click', exportReport);

  render();
})();
