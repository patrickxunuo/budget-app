import { expect, type Locator } from "@playwright/test";

/** Drives Piggy's visible combobox/listbox contract rather than a hidden form mirror. */
export async function chooseSelectOption(
  trigger: Locator,
  optionName: string | RegExp,
  expectedValue?: string,
) {
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const listboxId = await trigger.getAttribute("aria-controls");
  expect(listboxId).toBeTruthy();
  const listbox = trigger.page().locator(`[id="${listboxId}"]`);
  await expect(listbox).toBeVisible();
  await listbox.getByRole("option", { name: optionName }).click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  if (expectedValue !== undefined) {
    await expect(trigger).toHaveAttribute("data-value", expectedValue);
  }
}

/** Chooses the first enabled, non-placeholder row and returns its selected value and label. */
export async function chooseFirstSelectOption(trigger: Locator) {
  await trigger.click();
  const listboxId = await trigger.getAttribute("aria-controls");
  expect(listboxId).toBeTruthy();
  const options = trigger
    .page()
    .locator(`[id="${listboxId}"] [role="option"]:not([aria-disabled="true"])`);
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    const label = (await option.textContent())?.trim() ?? "";
    if (/^(all |choose |select )/i.test(label)) continue;
    await option.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    const value = await trigger.getAttribute("data-value");
    expect(value).toBeTruthy();
    return { label, value: value! };
  }
  throw new Error("No enabled non-placeholder select option was available.");
}
