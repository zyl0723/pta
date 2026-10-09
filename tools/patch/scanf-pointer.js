        const _scalar_raw = function (value) {
            if (typeof value === "number") {
                return value;
            }
            return String(value).charCodeAt(0);
        };
        const _write_element = function (arr, index, eleType, raw) {
            if (index < 0 || index >= arr.length) {
                rt.raiseException("写入数组时下标越界：位置 " + index + "，数组长度 " + arr.length);
            }
            arr[index] = rt.val(eleType, raw, true);
        };
        const _set_pointer_value = function (pointer, value, wide) {
            const storage = pointer && pointer.v;
            if (!storage || typeof storage !== "object") {
                rt.raiseException("scanf 的参数必须是变量地址（常见原因：变量名前漏写了 &）");
            }
            if (Array.isArray(storage.target)) {
                const arr = storage.target;
                const position = typeof storage.position === "number" ? storage.position : 0;
                const eleType = (pointer.t && pointer.t.eleType) || (arr[position] && arr[position].t) || rt.charTypeLiteral;
                if (wide) {
                    const text = String(value);
                    const need = position + text.length + 1;
                    if (need > arr.length) {
                        rt.raiseException("输入的内容太长，目标字符数组放不下（需要 " + need + " 个字符，数组只有 " + arr.length + " 个）");
                    }
                    for (let k = 0; k < text.length; k++) {
                        _write_element(arr, position + k, eleType, text.charCodeAt(k));
                    }
                    _write_element(arr, position + text.length, eleType, 0);
                    return;
                }
                _write_element(arr, position, eleType, _scalar_raw(value));
                return;
            }
            if (storage.target && typeof storage.target === "object" && "t" in storage.target && "v" in storage.target) {
                const targetType = storage.target.t;
                storage.target.v = rt.val(targetType, _scalar_raw(value), true).v;
                return;
            }
            rt.raiseException("scanf 的参数必须是变量地址（常见原因：变量名前漏写了 &）");
        };