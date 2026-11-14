# Clariva automatic file compression

## Approved policy

- Compression trigger: files larger than 15 MiB (15 × 1024 × 1024 bytes).
- PDF compression quality: moderate, JPEG quality 80, original embedded-image dimensions retained.
- Failure behaviour: retain and upload the original when it is within the 50 MiB hard limit.
- Hard upload ceiling: 50 MiB for the final file sent to Storage.

## Implementation

- PDF files larger than 15 MiB are processed in the browser before the resumable Supabase Storage upload.
- The compressor recompresses supported embedded raster images in place. It does not rasterise whole pages; text, fonts and vector drawing are intended to remain intact.
- Clariva validates the original and candidate PDF with PDF.js and checks that the page count is unchanged.
- PDFs containing common digital-signature markers are retained unchanged because rewriting a signed PDF can invalidate its signature.
- A candidate is accepted only if it is a valid PDF, smaller than the original, and no larger than 50 MiB.
- If compression fails, output validation fails, or the result is not smaller, the original is retained when it is no larger than 50 MiB.
- If the original exceeds 50 MiB and no valid compressed output meets the limit, the upload is rejected.
- DOC, DOCX, PPT and PPTX are not recompressed by this PDF-specific implementation. They remain unchanged and must already be within 50 MiB.
- Both device-selected files and Google Drive imports enter the same upload preparation pipeline.

## Runtime dependency

The browser loads `compress-pdf-lib@1.0.5` through a version-pinned ESM CDN URL. It is MIT-licensed. Its PDF image optimisation uses `pdf-lib@1.17.1` and browser-native Canvas encoding. Documents are processed in the browser; Clariva sends only the resulting file through its existing authenticated resumable Storage upload.

The compressor is loaded lazily only when a PDF above the threshold is selected. If the module cannot load, Clariva follows the approved original-file fallback and still enforces the 50 MiB ceiling.

## Manual verification still required

- Confirm a PDF below/equal to 15 MiB bypasses compression.
- Confirm a PDF above 15 MiB is reduced and remains readable/selectable.
- Confirm a PDF with no useful image savings retains the original.
- Confirm compression failure retains an original within 50 MiB.
- Confirm an original above 50 MiB is rejected if no valid compressed output is within the limit.
- Confirm DOC/DOCX/PPT/PPTX remain unchanged and respect the hard limit.
- Repeat with both local and Google Drive file sources, and test multi-file queue retries.
