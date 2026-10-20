import { scopeOf } from "../core/scope.js";
import { Base } from "../core/element.js";

export class TScope extends Base {
  get scope() {
    return scopeOf(this);
  }
}
