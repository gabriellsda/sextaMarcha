import { Component, inject, OnDestroy, OnInit, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { CurrencyPipe } from "@angular/common";
import { httpsCallable } from "firebase/functions";
import { functions } from "../core/firebase";

type CheckoutInfo = {
  courseTitle: string;
  amountCents: number;
  state: string;
  environment: string;
  paymentStatus: string;
  studentName: string;
  studentEmail: string;
  studentPhoneLast4: string;
  pixQrCode?: string | null;
  pixQrCodeUrl?: string | null;
  pixExpiresAt?: string | null;
};

type PixResponse = {
  paymentStatus: string;
  pixQrCode: string | null;
  pixQrCodeUrl: string | null;
  pixExpiresAt: string | null;
};

@Component({
  standalone: true,
  imports: [CurrencyPipe, RouterLink],
  templateUrl: "./checkout.component.html",
  styleUrl: "./checkout.component.css",
})
export class CheckoutComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  readonly loading = signal(true);
  readonly processing = signal(false);
  readonly copied = signal(false);
  readonly error = signal("");
  readonly info = signal<CheckoutInfo | null>(null);
  private token = "";
  private poll?: ReturnType<typeof setInterval>;

  async ngOnInit() {
    this.token = this.route.snapshot.paramMap.get("token") ?? "";
    await this.reload();
    this.poll = setInterval(() => {
      if (this.info()?.paymentStatus !== "paid" && this.info()?.pixQrCode) {
        void this.reload(false);
      }
    }, 8000);
  }

  ngOnDestroy() {
    if (this.poll) clearInterval(this.poll);
  }

  async reload(showLoading = true) {
    if (!functions) {
      this.error.set("Firebase não configurado.");
      this.loading.set(false);
      return;
    }
    if (showLoading) this.loading.set(true);
    try {
      const fn = httpsCallable<{ token: string }, CheckoutInfo>(
        functions,
        "getPublicCheckout",
      );
      this.info.set((await fn({ token: this.token })).data);
    } catch (err: unknown) {
      if (!this.info()) {
        const code =
          typeof err === "object" && err !== null && "code" in err
            ? String(err.code)
            : "";
        this.error.set(
          code === "functions/not-found"
            ? "Este link expirou ou não está mais disponível. Solicite um novo link ao despachante."
            : "Não conseguimos consultar seu pedido agora. Tente novamente em alguns instantes.",
        );
      }
    } finally {
      this.loading.set(false);
    }
  }

  async generatePix() {
    if (
      this.processing() ||
      this.info()?.paymentStatus === "paid" ||
      !functions
    ) {
      return;
    }
    this.processing.set(true);
    this.error.set("");
    try {
      const fn = httpsCallable<{ token: string }, PixResponse>(
        functions,
        "createPixCharge",
      );
      const result = (await fn({ token: this.token })).data;
      this.info.update((info) =>
        info
          ? {
              ...info,
              paymentStatus: result.paymentStatus,
              pixQrCode: result.pixQrCode,
              pixQrCodeUrl: this.safeQr(result.pixQrCodeUrl),
              pixExpiresAt: result.pixExpiresAt,
            }
          : info,
      );
    } catch (err: unknown) {
      this.error.set(this.safeError(err));
    } finally {
      this.processing.set(false);
    }
  }

  async copyPix() {
    const code = this.info()?.pixQrCode;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    this.copied.set(true);
  }

  private safeQr(value: string | null): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (
        url.protocol === "https:" &&
        (host === "api.pagar.me" || host.endsWith(".pagar.me"))
      ) {
        return url.toString();
      }
    } catch {
      return null;
    }
    return null;
  }

  private safeError(err: unknown): string {
    const message =
      typeof err === "object" &&
      err !== null &&
      "message" in err &&
      typeof err.message === "string"
        ? err.message
        : "";
    if (!message || /sk_test_|sk_live_|secret|token/i.test(message)) {
      return "Não foi possível gerar o PIX. O pedido continua pendente.";
    }
    return message;
  }
}
