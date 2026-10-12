import { ValueTransformer } from 'typeorm';

/**
 * PostgreSQL يعيد أعمدة numeric و bigint نصوصاً حتى لا يضيع شيء من الدقة.
 * المبالغ (numeric(18,2)) والعداد ICV أصغر بكثير من حد الأرقام الآمنة في JavaScript،
 * فنحوّلها إلى number عند القراءة.
 */
const toNumber = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: toNumber,
};

export const bigintTransformer: ValueTransformer = numericTransformer;
