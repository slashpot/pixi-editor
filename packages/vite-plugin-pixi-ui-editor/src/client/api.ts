import {
  API_BASE,
  API_HEADER,
  type EditRequest,
  type ElementInfo,
  type InsertRequest,
  type MoveRequest,
  type PaletteItem,
  type StructureResult,
} from '../shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const fetchElement = (src: string) => get<ElementInfo>(`/element?src=${encodeURIComponent(src)}`);
export const fetchPalette = () => get<PaletteItem[]>('/palette');

export const editElement = (req: EditRequest) => post<ElementInfo>('/edit', req);
export const insertElement = (req: InsertRequest) => post<StructureResult>('/insert', req);
export const duplicateElement = (req: { src: string; hash: string }) => post<StructureResult>('/duplicate', req);
export const moveElement = (req: MoveRequest) => post<StructureResult>('/move', req);
export const removeElement = (req: { src: string; hash: string }) => post<{ hash: string }>('/remove', req);
export const undo = () => post<{ file: string }>('/undo', {});
export const redo = () => post<{ file: string }>('/redo', {});

function get<T>(path: string) {
  return call<T>(path, { headers: { [API_HEADER]: '1' } });
}

function post<T>(path: string, body: unknown) {
  return call<T>(path, {
    method: 'POST',
    headers: { [API_HEADER]: '1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call<T>(path: string, init: Parameters<typeof fetch>[1]): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const json = await res.json();
  if (!res.ok) throw new ApiError(json.error ?? res.statusText, res.status);
  return json as T;
}
