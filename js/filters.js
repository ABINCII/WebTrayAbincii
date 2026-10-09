export class Filters {
  constructor({ container, onChange }) {
    this.container = container;
    this.onChange = onChange; // ({ type, category })

    this.state = { type: "all", category: "all" };
    this.products = [];
    this._build();
  }

  _build() {
    this.el = document.createElement("div");
    this.el.className = "ar-filters";

    // Type selector
    const typeSel = document.createElement("select");
    typeSel.className = "ar-filters__type";
    ["all", "meal", "drink"].forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v === "all" ? "All" : v === "meal" ? "Meals" : "Drinks";
      typeSel.appendChild(o);
    });
    typeSel.onchange = () => {
      this.state.type = typeSel.value;
      this._rebuildCategoryOptions();
      this._emit();
    };

    // Category dropdown
    const catSel = document.createElement("select");
    catSel.className = "ar-filters__category";
    catSel.onchange = () => {
      this.state.category = catSel.value;
      this._emit();
    };

    this.el.append(typeSel, catSel);
    this.container.appendChild(this.el);
    this.refs = { typeSel, catSel };
  }

  setProducts(products) {
    this.products = products;
    this._rebuildCategoryOptions();
  }

  _rebuildCategoryOptions() {
    const { typeSel, catSel } = this.refs;
    const filtered =
      this.state.type === "all"
        ? this.products
        : this.products.filter((p) => p.type === this.state.type);

    const categories = ["all", ...new Set(filtered.map((p) => p.category))];

    catSel.innerHTML = "";
    categories.forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c === "all" ? "All Categories" : c;
      catSel.appendChild(o);
    });

    // Reset category if it no longer exists
    if (!categories.includes(this.state.category)) {
      this.state.category = "all";
      catSel.value = "all";
    }
  }

  _emit() {
    this.onChange({ ...this.state });
  }

  apply(products) {
    return products.filter((p) => {
      if (this.state.type !== "all" && p.type !== this.state.type) return false;
      if (this.state.category !== "all" && p.category !== this.state.category)
        return false;
      return true;
    });
  }
}