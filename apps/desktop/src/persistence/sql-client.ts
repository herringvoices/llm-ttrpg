export type SqlBindValue = string | number | null | Uint8Array;

export interface SqlClient {
  execute(
    query: string,
    bindValues?: readonly SqlBindValue[],
  ): Promise<unknown>;
  select<T>(
    query: string,
    bindValues?: readonly SqlBindValue[],
  ): Promise<T>;
}
