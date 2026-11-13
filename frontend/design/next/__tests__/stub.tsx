/** Stand-in for a heavy v2 screen: proves which screen a next route mounted. */
export const stub = (name: string) => ({ [name]: () => <div data-testid="mounted">{name}</div> });
