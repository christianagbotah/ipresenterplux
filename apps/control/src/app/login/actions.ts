"use server";

import { AuthError } from "next-auth";
import { signIn } from "@auth";

export async function authenticate(
  _previousState: string | undefined,
  formData: FormData
) {
  try {
    await signIn("credentials", formData);
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return "Invalid email or password.";
      }
      return "Unable to sign in right now.";
    }
    throw error;
  }
}
