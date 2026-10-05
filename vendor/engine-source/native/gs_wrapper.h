/*
 * Thin C wrapper around the Ghostscript API for WebAssembly.
 *
 * Exposes a small, stable ABI that the JavaScript layer can call via
 * ccall/cwrap. The wrapper is responsible only for Ghostscript
 * initialization and execution; it knows nothing about the UI.
 */

#ifndef GS_WRAPPER_H
#define GS_WRAPPER_H

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Initialise the Ghostscript interpreter instance.
 * Returns 0 on success, non-zero on error.
 */
int gs_initialize(void);

/*
 * Process a PDF file and write a compressed PDF using a named preset.
 *
 * Kept for backwards compatibility; maps a small set of well-known preset
 * names to Ghostscript arguments internally. New code should prefer
 * gs_process_pdf_argv.
 *
 * Returns 0 on success, non-zero Ghostscript error code on failure.
 */
int gs_process_pdf(
    const char *input_path,
    const char *output_path,
    const char *preset
);

/*
 * Process a PDF file and write a compressed PDF.
 *
 * input_path  - absolute path inside the Emscripten virtual filesystem
 * output_path - absolute path for the resulting PDF
 * extra_args  - newline-delimited list of extra Ghostscript options to
 *               append after the fixed, safe base arguments and before
 *               "-sOutputFile". The input/output file paths are added by
 *               this function and may not appear in extra_args.
 *
 * The base argument set (NOPAUSE/BATCH/SAFER/pdfwrite/etc.) is fixed in
 * C so untrusted JavaScript can never disable safety switches. Callers
 * pass only presentation choices (resolution, filters, quality).
 *
 * Returns 0 on success, non-zero Ghostscript error code on failure.
 */
int gs_process_pdf_argv(
    const char *input_path,
    const char *output_path,
    const char *extra_args
);

/*
 * Merge multiple PDF files into a single PDF via the pdfwrite device.
 *
 * inputs_blob - newline-delimited list of absolute paths inside the
 *               Emscripten virtual filesystem (in merge order)
 * output_path - absolute path for the resulting merged PDF
 * extra_args  - newline-delimited list of extra Ghostscript options, or
 *               an empty string to preserve quality (no downsampling)
 *
 * The fixed safety + pdfwrite base arguments are added by this function.
 *
 * Returns 0 on success, non-zero Ghostscript error code on failure.
 */
int gs_process_pdfs(
    const char *inputs_blob,
    const char *output_path,
    const char *extra_args
);

/*
 * Run Ghostscript with a caller-supplied option list.
 *
 * DEV/benchmark helper only. NOT used by the web worker. The caller
 * provides the full option list (newline-delimited) including the
 * device; the wrapper appends "-sOutputFile=<output_path>", "--" and the
 * input path. The fixed safety arguments (-dSAFER etc.) are always
 * prepended.
 *
 * Returns 0 on success, non-zero Ghostscript error code on failure.
 */
int gs_run(
    const char *input_path,
    const char *output_path,
    const char *args_blob
);

/*
 * Return the last error message emitted by Ghostscript on stderr
 * (or an empty string). Valid until the next gs_* call.
 */
const char *gs_get_last_error(void);

/*
 * Shut down the Ghostscript interpreter instance.
 */
void gs_shutdown(void);

#ifdef __cplusplus
}
#endif

#endif /* GS_WRAPPER_H */
