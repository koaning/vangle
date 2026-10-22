import { ChoiceElement } from "../core/choice.js";

// <t-choice name="n" options="yearly:1, monthly:12, daily:365">monthly</t-choice>
// Click to cycle through the options.
export class TChoice extends ChoiceElement {
  handlers() {
    return {
      click: (event) => this.step(event.shiftKey ? -1 : 1),
      keydown: (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "ArrowRight") this.step(1);
        else if (event.key === "ArrowLeft") this.step(-1);
        else return;
        event.preventDefault();
      },
    };
  }
}
