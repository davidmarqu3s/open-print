/*
 * Thin C wrapper around the Ghostscript API for WebAssembly.
 */

#include "gs_wrapper.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "iapi.h"     /* Ghostscript C API */
#include "ierrors.h"  /* gs_error_* codes */

#define MAX_OPTIONS   96
#define MAX_INPUTS    96
#define MAX_OPTION_LEN 256

static void *gs_instance = NULL;
static int gs_instance_exited = 0;

/* Last stderr message emitted by Ghostscript (for error reporting). */
static char gs_error_buf[1024];
static size_t gs_error_len = 0;

/*
 * Default stdio callbacks for the Emscripten environment. Ghostscript
 * calls these for interpreter output and error messages.
 */
static int GSDLLCALL stdin_callback(void *caller_handle, char *buf, int len)
{
    (void)caller_handle;
    (void)buf;
    (void)len;
    return 0;
}

static int GSDLLCALL stdout_callback(void *caller_handle, const char *str, int len)
{
    (void)caller_handle;
    (void)str;
    (void)len;
    return len;
}

static int GSDLLCALL stderr_callback(void *caller_handle, const char *str, int len)
{
    (void)caller_handle;
    if (str != NULL && len > 0) {
        if (gs_error_len + (size_t)len < sizeof(gs_error_buf) - 1) {
            memcpy(gs_error_buf + gs_error_len, str, (size_t)len);
            gs_error_len += (size_t)len;
            gs_error_buf[gs_error_len] = '\0';
        }
        fwrite(str, 1, (size_t)len, stderr);
    }
    return len;
}

/*
 * Map a human-readable preset name to Ghostscript arguments.
 * Only used by the legacy gs_process_pdf() entry point; the worker
 * passes explicit arguments via gs_process_pdf_argv().
 */
static const char *preset_to_args(const char *preset)
{
    if (preset == NULL || preset[0] == '\0') {
        return "-dPDFSETTINGS=/default";
    }

    if (strcmp(preset, "screen") == 0 || strcmp(preset, "max") == 0) {
        return "-dPDFSETTINGS=/screen\n"
               "-dColorImageResolution=72\n"
               "-dGrayImageResolution=72\n"
               "-dMonoImageResolution=300\n"
               "-dAutoFilterColorImages=false\n"
               "-dAutoFilterGrayImages=false\n"
               "-dJPEGQ=40\n"
               "-dEmbedAllFonts=true\n"
               "-dSubsetFonts=true";
    }

    if (strcmp(preset, "ebook") == 0 || strcmp(preset, "balanced") == 0) {
        return "-dPDFSETTINGS=/ebook\n"
               "-dColorImageResolution=110\n"
               "-dGrayImageResolution=110\n"
               "-dMonoImageResolution=300\n"
               "-dJPEGQ=75\n"
               "-dEmbedAllFonts=true\n"
               "-dSubsetFonts=true";
    }

    if (strcmp(preset, "printer") == 0 || strcmp(preset, "highQuality") == 0) {
        return "-dPDFSETTINGS=/printer\n"
               "-dColorImageResolution=300\n"
               "-dGrayImageResolution=300\n"
               "-dMonoImageResolution=600\n"
               "-dJPEGQ=92\n"
               "-dEmbedAllFonts=true\n"
               "-dSubsetFonts=true";
    }

    if (strcmp(preset, "prepress") == 0) {
        return "-dPDFSETTINGS=/prepress\n"
               "-dEmbedAllFonts=true\n"
               "-dSubsetFonts=true";
    }

    return "-dPDFSETTINGS=/default";
}

/*
 * Create a fresh Ghostscript instance.
 */
static int create_instance(void)
{
    int code;

    if (gs_instance != NULL) {
        gsapi_delete_instance(gs_instance);
        gs_instance = NULL;
    }

    code = gsapi_new_instance(&gs_instance, NULL);
    if (code < 0) {
        fprintf(stderr, "gsapi_new_instance failed: %d\n", code);
        gs_instance = NULL;
        return code;
    }

    gs_instance_exited = 0;

    return 0;
}

int gs_initialize(void)
{
    if (gs_instance != NULL) {
        return 0;
    }

    return create_instance();
}

/*
 * Split a newline-delimited option string into an array of trimmed lines.
 */
static int split_option_lines(const char *blob, char out[MAX_OPTIONS][MAX_OPTION_LEN])
{
    int n = 0;
    const char *p = blob;

    if (blob == NULL) {
        return 0;
    }

    while (*p != '\0' && n < MAX_OPTIONS) {
        const char *nl = strchr(p, '\n');
        size_t len = nl ? (size_t)(nl - p) : strlen(p);

        while (len > 0 && (p[len - 1] == '\r' || p[len - 1] == ' ' || p[len - 1] == '\t')) {
            len--;
        }

        size_t start = 0;
        while (start < len && (p[start] == ' ' || p[start] == '\t')) {
            start++;
        }
        len -= start;

        if (len > 0) {
            if (len >= MAX_OPTION_LEN) {
                len = MAX_OPTION_LEN - 1;
            }
            memcpy(out[n], p + start, len);
            out[n][len] = '\0';
            n++;
        }

        if (nl == NULL) {
            break;
        }
        p = nl + 1;
    }

    return n;
}

/*
 * Core runner: build the argument list and invoke Ghostscript once.
 *
 * input_paths  - one or more input files; for pdfwrite these are
 *                concatenated into a single output (used for merging).
 * include_pdfwrite_base selects whether the fixed pdfwrite device
 * arguments are prepended (used by the compress/merge paths). The safety
 * arguments (-dNOPAUSE -dBATCH -dSAFER etc.) are always included.
 */
static int run_gs(const char *input_paths[], int num_inputs,
                  const char *output_path,
                  const char *option_blob, int include_pdfwrite_base)
{
    int code;
    int result;
    int i;
    char output_device_arg[MAX_OPTION_LEN];
    char option_storage[MAX_OPTIONS][MAX_OPTION_LEN];
    int option_count;

    static const char *const base_argv[] = {
        "gs",
        "-dNOPAUSE",
        "-dBATCH",
        "-dSAFER",
        "-dQUIET",
        "-dNOINTERPOLATE",
        "-dNumRenderingThreads=1",
        NULL
    };

    static const char *const pdfwrite_argv[] = {
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        "-dAutoRotatePages=/None",
        NULL
    };

    if (input_paths == NULL || num_inputs < 1 || output_path == NULL) {
        return gs_error_Fatal;
    }

    if (gs_instance == NULL) {
        code = gs_initialize();
        if (code < 0) {
            return code;
        }
    } else {
        /* A gsapi_exit'd instance cannot safely run another job. */
        code = create_instance();
        if (code < 0) {
            return code;
        }
    }

    /* Reset the error buffer for this job. */
    gs_error_len = 0;
    gs_error_buf[0] = '\0';

    option_count = split_option_lines(option_blob, option_storage);

    const char *argv[6 + 3 + MAX_OPTIONS + 2 + MAX_INPUTS + 1];
    int argc = 0;

    for (i = 0; base_argv[i] != NULL; i++) {
        argv[argc++] = base_argv[i];
    }
    if (include_pdfwrite_base) {
        for (i = 0; pdfwrite_argv[i] != NULL; i++) {
            argv[argc++] = pdfwrite_argv[i];
        }
    }
    for (i = 0; i < option_count; i++) {
        argv[argc++] = option_storage[i];
    }

    (void)snprintf(output_device_arg, sizeof(output_device_arg),
                   "-sOutputFile=%s", output_path);
    argv[argc++] = output_device_arg;
    for (i = 0; i < num_inputs; i++) {
        argv[argc++] = input_paths[i];
    }
    argv[argc] = NULL;

    /*
     * Set stdio callbacks that are safe under Emscripten. These prevent
     * Ghostscript from trying to read/write the host libc stdio directly.
     */
    code = gsapi_set_stdio(gs_instance, stdin_callback, stdout_callback, stderr_callback);
    if (code < 0) {
        fprintf(stderr, "gsapi_set_stdio failed: %d\n", code);
        result = code;
        goto cleanup;
    }

    code = gsapi_init_with_args(gs_instance, argc, (char **)argv);

    /*
     * Ghostscript returns gs_error_Quit (-101) on a normal exit caused by
     * the -dBATCH flag. Treat that as success.
     */
    if (code == 0 || code == gs_error_Quit) {
        result = 0;
    } else {
        fprintf(stderr, "gsapi_init_with_args failed: %d\n", code);
        result = code;
    }

cleanup:
    /*
     * Exit the interpreter context for this job. The instance itself is
     * kept alive for potential reuse; on error we recreate it so the next
     * job starts from a clean state.
     */
    gsapi_exit(gs_instance);
    gs_instance_exited = 1;

    if (result < 0) {
        create_instance();
    }

    return result;
}

int gs_process_pdf(
    const char *input_path,
    const char *output_path,
    const char *preset
)
{
    const char *inputs[1] = { input_path };
    return run_gs(inputs, 1, output_path, preset_to_args(preset), 1);
}

int gs_process_pdf_argv(
    const char *input_path,
    const char *output_path,
    const char *extra_args
)
{
    const char *inputs[1] = { input_path };
    return run_gs(inputs, 1, output_path, extra_args, 1);
}

int gs_process_pdfs(
    const char *inputs_blob,
    const char *output_path,
    const char *extra_args
)
{
    char path_storage[MAX_INPUTS][MAX_OPTION_LEN];
    const char *inputs[MAX_INPUTS];
    int n = split_option_lines(inputs_blob, path_storage);
    int i;

    if (n < 1) {
        return gs_error_Fatal;
    }
    for (i = 0; i < n; i++) {
        inputs[i] = path_storage[i];
    }

    return run_gs(inputs, n, output_path, extra_args, 1);
}

int gs_run(
    const char *input_path,
    const char *output_path,
    const char *args_blob
)
{
    const char *inputs[1] = { input_path };
    return run_gs(inputs, 1, output_path, args_blob, 0);
}

const char *gs_get_last_error(void)
{
    return gs_error_buf;
}

void gs_shutdown(void)
{
    if (gs_instance != NULL) {
        /*
         * run_gs already called gsapi_exit after each job. Only exit here
         * if no job ran yet (e.g. initialize + shutdown), then destroy the
         * instance. Calling gsapi_exit twice crashes, so the flag guards
         * against a double exit.
         */
        if (!gs_instance_exited) {
            gsapi_exit(gs_instance);
        }
        gsapi_delete_instance(gs_instance);
        gs_instance = NULL;
        gs_instance_exited = 0;
    }
}
