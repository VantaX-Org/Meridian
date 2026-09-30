/**
 * Aurora <Pager> — "1–100 of 4,210 gaps" with Previous / Next for server-paged lists.
 */

import { Button } from "../primitives/button";
import { Stack } from "../primitives/stack";
import { Text } from "../primitives/text";

export interface PagerProps {
  offset: number;
  total: number;
  pageSize: number;
  onChange: (offset: number) => void;
  noun: string;
}

export function Pager({ offset, total, pageSize, onChange, noun }: PagerProps) {
  return (
    <Stack direction="row" justify="between" align="center">
      <Text variant="text-small" tone="secondary" numeric>
        {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + pageSize, total)}`} of {total.toLocaleString()} {noun}
      </Text>
      <Stack direction="row" gap={2}>
        <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>
          Previous
        </Button>
        <Button size="sm" variant="ghost" disabled={offset + pageSize >= total} onClick={() => onChange(offset + pageSize)}>
          Next
        </Button>
      </Stack>
    </Stack>
  );
}
