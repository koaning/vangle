import { menu, closeMenu, openMenu } from "../core/interaction.js";
import { ChoiceElement } from "../core/choice.js";

// <t-select name="g" options="Mercury:3.7, Venus:8.87, Earth:9.81, …">Earth</t-select>
// Click to open a menu of the options, and type to search it. For long lists.
export class TSelect extends ChoiceElement {
  connectedCallback() {
    super.connectedCallback();
    if (!this._options) return;
    this.setAttribute("aria-haspopup", "listbox");
    this.setAttribute("aria-expanded", "false");
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (menu?.el === this) closeMenu();
  }
  handlers() {
    let wasOpen = false;
    return {
      // A click on the word while its menu is open closes the menu (the search field
      // loses focus first), rather than opening it again.
      pointerdown: () => (wasOpen = menu?.el === this),
      click: () => {
        if (!wasOpen) openMenu(this, this._options);
        wasOpen = false;
      },
      keydown: (event) => {
        if (event.altKey || event.metaKey || event.ctrlKey) return;
        if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") openMenu(this, this._options);
        else if (event.key === "ArrowRight") this.step(1);
        else if (event.key === "ArrowLeft") this.step(-1);
        else if (event.key.length === 1) openMenu(this, this._options, event.key);
        else return;
        event.preventDefault();
      },
    };
  }
}
