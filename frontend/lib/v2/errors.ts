import { isAxiosError } from "axios";
import { apiErrorMessage } from "@/lib/error";

/**
 * The sentence for a failed action: what the API said when it said something, the message of an error the client raised
 * itself (a refused download carries the API's sentence), else the plain account of the failed request.
 */
export function failureText(error: unknown): string {
  return error instanceof Error && !isAxiosError(error) && error.message ? error.message : apiErrorMessage(error);
}
