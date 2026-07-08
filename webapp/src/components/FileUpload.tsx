import { useCallback, useRef, useState } from "react";
import { parseCSVFile } from "@/lib/csv";
import type { ParsedDataset } from "@/types";

interface FileUploadProps {
  label: string;
  description: string;
  onFileLoaded: (dataset: ParsedDataset) => void;
  onClear: () => void;
  dataset: ParsedDataset | null;
}

export function FileUpload({
  label,
  description,
  onFileLoaded,
  onClear,
  dataset,
}: FileUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [columnsExpanded, setColumnsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.name.endsWith(".csv")) {
        setError("Please upload a CSV file.");
        return;
      }
      try {
        const parsed = await parseCSVFile(file);
        onFileLoaded(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse CSV.");
      }
    },
    [onFileLoaded]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  if (dataset) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{label}</h3>
          <button
            onClick={onClear}
            className="text-sm text-red-600 hover:text-red-800"
          >
            Remove
          </button>
        </div>
        <p className="text-sm text-gray-600">{dataset.fileName}</p>
        <div className="mt-2 flex gap-4 text-xs text-gray-500">
          <span>{dataset.rows.length} rows</span>
          <span>{dataset.headers.length} columns</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {(columnsExpanded ? dataset.headers : dataset.headers.slice(0, 5)).map(
            (h, i) => (
              <span
                key={`${h}-${i}`}
                className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800"
              >
                {h}
              </span>
            )
          )}
          {dataset.headers.length > 5 && (
            <button
              onClick={() => setColumnsExpanded((v) => !v)}
              className="rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-800"
            >
              {columnsExpanded
                ? "show fewer"
                : `+${dataset.headers.length - 5} more`}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? "border-blue-400 bg-blue-50"
            : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
        }`}
      >
        <h3 className="mb-1 font-semibold text-gray-900">{label}</h3>
        <p className="mb-3 text-sm text-gray-500">{description}</p>
        <p className="text-sm text-gray-400">
          Drag & drop a CSV file here, or click to browse
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
