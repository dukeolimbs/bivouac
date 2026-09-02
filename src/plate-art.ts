/**
 * Bivouac — which image a Cast Bar plate shows.
 *
 * Three things that all answer the same question, kept together and out of
 * `cast-bar.ts` (which is long enough):
 *
 *  • `pickImageSource()` — the Profile / Token / Custom choice made when an actor
 *    is first dropped on the bar.
 *  • `pickImageFile()` — Foundry's file picker, wrapped so that closing it
 *    without choosing resolves instead of hanging.
 *  • `openPlateArt()` — the full art editor for an existing plate: its base image
 *    plus the optional injured and critical variants.
 *
 * The editor is also the only way to change a plate's NORMAL art after it has
 * been added. Until now the Profile/Token/Custom choice was made once, on drop,
 * and was then fixed for the life of the plate — picking the wrong one meant
 * removing the character and adding them again.
 */

import { MODULE_ID, SETTINGS } from "./constants";

const t = (k: string): string => game.i18n.localize(k);

function esc(v: unknown): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The art half of a Plate — the fields this editor owns. */
export interface PlateArt {
  art: "profile" | "token";
  img?: string;
  imgInjured?: string;
  imgCritical?: string;
}

/** Ask which image to use for a dropped actor. Returns the choice, or null if
 *  the dialog was dismissed. */
export async function pickImageSource(): Promise<
  "profile" | "token" | "custom" | null
> {
  const result = await foundry.applications.api.DialogV2.wait({
    window: {
      title: t("BIVOUAC.CastBar.ImageTitle"),
      icon: "fa-solid fa-image",
    },
    classes: ["bivouac-dialog", "bivouac-dialog--picker"],
    position: { width: 560 }, // same as the tile picker, so both land on a 3-across grid
    content: `<p class="bivouac-pick-hint">${t("BIVOUAC.CastBar.ImagePrompt")}</p>`,
    buttons: [
      {
        action: "profile",
        label: t("BIVOUAC.CastBar.ImageProfile"),
        icon: "fa-solid fa-user",
        default: true,
      },
      {
        action: "token",
        label: t("BIVOUAC.CastBar.ImageToken"),
        icon: "fa-solid fa-chess-pawn",
      },
      {
        action: "custom",
        label: t("BIVOUAC.CastBar.ImageCustom"),
        icon: "fa-solid fa-folder-open",
      },
    ],
    rejectClose: false,
  }).catch(() => null);
  return result === "profile" || result === "token" || result === "custom"
    ? result
    : null;
}

/** Open Foundry's file picker and resolve with the chosen image path — or
 *  `undefined` if it's closed without a selection (so the caller can abandon).
 *  Wrapping the instance's `close()` catches cancel without relying on a hook
 *  name; a selection resolves first via the callback, so the close is a no-op. */
export function pickImageFile(current?: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const FP = (foundry.applications?.apps?.FilePicker?.implementation ??
      (globalThis as { FilePicker?: unknown }).FilePicker) as
      | (new (o: unknown) => {
          render: (b: boolean) => void;
          close: (o?: unknown) => Promise<unknown>;
        })
      | undefined;
    if (!FP) {
      resolve(undefined);
      return;
    }
    let done = false;
    const finish = (v: string | undefined): void => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const picker = new FP({
      type: "image",
      current: current || undefined,
      callback: (path: string) => finish(path),
    });
    const close = picker.close.bind(picker);
    picker.close = (opts?: unknown): Promise<unknown> => {
      finish(undefined);
      return close(opts);
    };
    picker.render(true);
  });
}

/* ------------------------------------------------ the art editor -------- */

/** A threshold as the editor labels it, e.g. "50%". Read live so the dialog
 *  always states the world's ACTUAL thresholds rather than the defaults — the
 *  whole point of making them configurable. */
function pct(key: string, fallback: number): string {
  try {
    const n = Number(game.settings.get(MODULE_ID, key));
    return `${Number.isFinite(n) ? n : fallback}%`;
  } catch {
    return `${fallback}%`;
  }
}

/** One file row: thumbnail, path, browse, clear. `slot` names the hidden input
 *  the OK handler reads back. */
function slotHtml(
  slot: string,
  label: string,
  hint: string,
  value: string,
  placeholder: string,
): string {
  return `
    <div class="bivouac-art__slot" data-slot="${slot}">
      <div class="bivouac-art__thumb">
        <img src="${esc(value || placeholder)}" alt="">
      </div>
      <div class="bivouac-art__body">
        <label class="bivouac-art__label">${esc(label)}</label>
        <p class="bivouac-art__hint">${esc(hint)}</p>
        <div class="bivouac-art__row">
          <input type="text" name="${slot}" value="${esc(value)}" placeholder="${esc(placeholder)}" readonly>
          <button type="button" class="bivouac-art__btn" data-browse title="${esc(t("BIVOUAC.CastBar.ArtBrowse"))}">
            <i class="fa-solid fa-folder-open"></i>
          </button>
          <button type="button" class="bivouac-art__btn" data-clear title="${esc(t("BIVOUAC.CastBar.ArtClear"))}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
    </div>`;
}

function editorHtml(
  cur: PlateArt,
  name: string,
  profileImg: string,
  tokenImg: string,
): string {
  const base = cur.img ?? "";
  const src = (s: string): string =>
    `<label class="bivouac-art__src">
       <input type="radio" name="artSource" value="${s}"${
         (base ? "custom" : cur.art) === s ? " checked" : ""
       }>
       <span>${esc(t(`BIVOUAC.CastBar.Image${s[0].toUpperCase()}${s.slice(1)}`))}</span>
     </label>`;
  return `
    <div class="bivouac-art">
      <p class="bivouac-art__who">${esc(name)}</p>

      <fieldset class="bivouac-art__group">
        <legend>${esc(t("BIVOUAC.CastBar.ArtBase"))}</legend>
        <div class="bivouac-art__sources">${src("profile")}${src("token")}${src("custom")}</div>
        ${slotHtml(
          "img",
          t("BIVOUAC.CastBar.ArtCustom"),
          t("BIVOUAC.CastBar.ArtCustomHint"),
          base,
          profileImg || tokenImg,
        )}
      </fieldset>

      <fieldset class="bivouac-art__group">
        <legend>${esc(t("BIVOUAC.CastBar.ArtWounded"))}</legend>
        <p class="bivouac-art__note">${esc(t("BIVOUAC.CastBar.ArtWoundedHint"))}</p>
        ${slotHtml(
          "imgInjured",
          t("BIVOUAC.CastBar.ArtInjured"),
          t("BIVOUAC.CastBar.ArtAtOrBelow").replace(
            "%s",
            pct(SETTINGS.castWoundInjured, 50),
          ),
          cur.imgInjured ?? "",
          profileImg || tokenImg,
        )}
        ${slotHtml(
          "imgCritical",
          t("BIVOUAC.CastBar.ArtCritical"),
          t("BIVOUAC.CastBar.ArtAtOrBelow").replace(
            "%s",
            pct(SETTINGS.castWoundCritical, 10),
          ),
          cur.imgCritical ?? "",
          profileImg || tokenImg,
        )}
      </fieldset>
    </div>`;
}

/** Wire browse / clear / thumbnail-sync inside the art dialog.
 *
 *  Registered once, as its own `renderDialogV2` listener scoped by our own root
 *  class — the same arrangement the tile config and the custom-stats editor use,
 *  so it can never reach into another dialog (ours or another module's). */
let hookReady = false;
function ensureEditorHook(): void {
  if (hookReady) return;
  hookReady = true;
  Hooks.on("renderDialogV2", (_app: unknown, html: unknown) => {
    const root =
      html instanceof HTMLElement
        ? html
        : (html as { [0]?: HTMLElement } | null)?.[0];
    const form = root?.querySelector?.(".bivouac-art") as HTMLElement | null;
    if (!form) return;

    const sync = (slot: HTMLElement): void => {
      const input = slot.querySelector<HTMLInputElement>("input[type=text]");
      const img = slot.querySelector("img");
      if (input && img) img.setAttribute("src", input.value || input.placeholder);
    };

    form.addEventListener("click", (e) => {
      const el = e.target as HTMLElement | null;
      const slot = el?.closest<HTMLElement>(".bivouac-art__slot");
      if (!slot) return;
      const input = slot.querySelector<HTMLInputElement>("input[type=text]");
      if (!input) return;
      if (el?.closest("[data-clear]")) {
        input.value = "";
        sync(slot);
        // Clearing the BASE image falls back to the document's own art, so the
        // source radios become meaningful again — land on Profile rather than
        // leaving "Custom" selected with nothing behind it.
        if (input.name === "img")
          form.querySelector<HTMLInputElement>('input[value="profile"]')?.click();
        return;
      }
      if (el?.closest("[data-browse]")) {
        void pickImageFile(input.value).then((path) => {
          if (!path) return;
          input.value = path;
          sync(slot);
          // Browsing for the base image IS choosing "custom" — otherwise the
          // path would be saved and then ignored by the radio.
          if (input.name === "img")
            form.querySelector<HTMLInputElement>('input[value="custom"]')?.click();
        });
      }
    });
  });
}

/**
 * Open the art editor for one plate. Resolves with the new art, or null if the
 * dialog was cancelled.
 *
 * `profileImg` / `tokenImg` are the document's own two images, used as the
 * thumbnail placeholders so the empty slots show what the plate would fall back
 * to rather than a broken-image icon.
 */
export async function openPlateArt(
  current: PlateArt,
  name: string,
  profileImg: string,
  tokenImg: string,
): Promise<PlateArt | null> {
  ensureEditorHook();
  const result = await foundry.applications.api.DialogV2.prompt({
    window: {
      title: t("BIVOUAC.CastBar.ArtTitle"),
      icon: "fa-solid fa-image",
      resizable: true,
    },
    classes: ["bivouac-dialog"],
    position: { width: 520 },
    content: editorHtml(current, name, profileImg, tokenImg),
    ok: {
      label: t("BIVOUAC.Edit.Save"),
      icon: "fa-solid fa-check",
      callback: (_e: Event, button: { form: HTMLFormElement }): PlateArt => {
        const f = button.form;
        const get = (n: string): string =>
          (f.elements.namedItem(n) as HTMLInputElement | null)?.value.trim() ?? "";
        const source = String(
          (f.elements.namedItem("artSource") as RadioNodeList | null)?.value ??
            "profile",
        );
        const img = get("img");
        return {
          // "custom" with an empty path is the same thing as no custom image, so
          // it collapses back to the document's own profile art. Storing the
          // radio without the path would leave a plate pointing at nothing.
          art: source === "token" ? "token" : "profile",
          img: source === "custom" && img ? img : undefined,
          imgInjured: get("imgInjured") || undefined,
          imgCritical: get("imgCritical") || undefined,
        };
      },
    },
    rejectClose: false,
  }).catch(() => null);
  return (result as PlateArt | null) ?? null;
}
