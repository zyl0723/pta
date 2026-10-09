        const _scanf_read_scanset = (scanset, width) => {
            if (_at_input_eof()) {
                return null;
            }
            let cls = scanset.set.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
            if (scanset.negate) {
                cls = cls.replace(/\^/g, '\\^');
            }
            return _scan_token(new RegExp('^[' + (scanset.negate ? '^' : '') + cls + ']+'), width);
        };
        const _scanf_convert = (conv, width, scanset) => {
            switch (conv) {
                case 'd':
                case 'u': {
                    _skip_whitespace();
                    const text = _scan_token(/^[-+]?[0-9]+/, width);
                    return text === null ? { ok: false } : { ok: true, value: _parse_integer_text(text, 10) };
                }
                case 'i': {
                    _skip_whitespace();
                    const text = _scan_token(/^[-+]?(?:0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)/, width);
                    if (text === null) {
                        return { ok: false };
                    }
                    if (/^[-+]?0[xX]/.test(text)) {
                        return { ok: true, value: _parse_integer_text(text, 16) };
                    }
                    if (/^[-+]?0[0-7]+$/.test(text)) {
                        return { ok: true, value: _parse_integer_text(text.replace(/^([-+]?)0/, '$1'), 8) };
                    }
                    return { ok: true, value: _parse_integer_text(text, 10) };
                }
                case 'o': {
                    _skip_whitespace();
                    const text = _scan_token(/^[-+]?[0-7]+/, width);
                    return text === null ? { ok: false } : { ok: true, value: _parse_integer_text(text, 8) };
                }
                case 'x':
                case 'X': {
                    _skip_whitespace();
                    const text = _scan_token(/^[-+]?(?:0[xX])?[0-9a-fA-F]+/, width);
                    return text === null ? { ok: false } : { ok: true, value: _parse_integer_text(text, 16) };
                }
                case 'f':
                case 'F':
                case 'e':
                case 'E':
                case 'g':
                case 'G': {
                    _skip_whitespace();
                    const text = _scan_token(/^[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?/, width);
                    return text === null ? { ok: false } : { ok: true, value: parseFloat(text) };
                }
                case 'c': {
                    const count = width > 0 ? width : 1;
                    if (_at_input_eof()) {
                        return { ok: false };
                    }
                    const take = Math.min(count, input_stream.length);
                    const text = input_stream.substr(0, take);
                    input_stream = input_stream.substr(take);
                    return { ok: true, value: text, wide: count > 1 };
                }
                case 's': {
                    _skip_whitespace();
                    const text = _scan_token(/^\S+/, width);
                    return text === null ? { ok: false } : { ok: true, value: text, wide: true };
                }
                case '[': {
                    const text = _scanf_read_scanset(scanset, width);
                    return text === null ? { ok: false } : { ok: true, value: text, wide: true };
                }
                default:
                    return { ok: false, unsupported: true };
            }
        };
        const _scanf_impl = (rt, format, args) => {
            let fi = 0;
            let argIndex = 0;
            let assigned = 0;
            const stop = () => (assigned === 0 && _at_input_eof() ? -1 : assigned);
            while (fi < format.length) {
                const ch = format[fi];
                if (/[ \t\n\r\v\f]/.test(ch)) {
                    _skip_whitespace();
                    fi++;
                    continue;
                }
                if (ch !== '%') {
                    if (_at_input_eof() || input_stream[0] !== ch) {
                        return stop();
                    }
                    input_stream = input_stream.substr(1);
                    fi++;
                    continue;
                }
                if (format[fi + 1] === '%') {
                    if (_at_input_eof() || input_stream[0] !== '%') {
                        return stop();
                    }
                    input_stream = input_stream.substr(1);
                    fi += 2;
                    continue;
                }
                let j = fi + 1;
                let suppress = false;
                if (format[j] === '*') {
                    suppress = true;
                    j++;
                }
                let widthText = '';
                while (j < format.length && format[j] >= '0' && format[j] <= '9') {
                    widthText += format[j];
                    j++;
                }
                if (format.substr(j, 2) === 'hh' || format.substr(j, 2) === 'll') {
                    j += 2;
                }
                else if ('hlLqjzt'.indexOf(format[j]) >= 0) {
                    j++;
                }
                let conv = format[j];
                let scanset = null;
                if (conv === '[') {
                    let k = j + 1;
                    let negate = false;
                    if (format[k] === '^') {
                        negate = true;
                        k++;
                    }
                    let set = '';
                    if (format[k] === ']') {
                        set += ']';
                        k++;
                    }
                    while (k < format.length && format[k] !== ']') {
                        set += format[k];
                        k++;
                    }
                    if (k >= format.length) {
                        break;
                    }
                    scanset = { negate: negate, set: set };
                    j = k + 1;
                }
                else {
                    j = j + 1;
                }
                fi = j;
                const width = widthText.length > 0 ? parseInt(widthText, 10) : 0;
                const target = suppress ? null : args[argIndex];
                if (!suppress) {
                    argIndex++;
                }
                const res = _scanf_convert(conv, width, scanset);
                if (res.unsupported) {
                    rt.raiseException('scanf: 暂不支持的格式 "%' + conv + '"');
                }
                if (!res.ok) {
                    return stop();
                }
                if (!suppress) {
                    _set_pointer_value(target, res.value, res.wide === true);
                    assigned++;
                }
            }
            return assigned;
        };
        const _scanf = function (rt, _this, pchar, ...args) {
            const format = rt.getStringFromCharArray(pchar);
            return rt.val(rt.intTypeLiteral, _scanf_impl(rt, format, args));
        };
        rt.regFunc(_scanf, "global", "scanf", [char_pointer, "?"], rt.intTypeLiteral);
        const _sscanf = function (rt, _this, original_string_pointer, format_pointer, ...args) {
            const format = rt.getStringFromCharArray(format_pointer);
            const original_string = rt.getStringFromCharArray(original_string_pointer);
            const saved_input_stream = input_stream;
            input_stream = original_string;
            let result;
            try {
                result = _scanf_impl(rt, format, args);
            }
            finally {
                input_stream = saved_input_stream;
            }
            return rt.val(rt.intTypeLiteral, result);
        };
        return rt.regFunc(_sscanf, "global", "sscanf", [char_pointer, char_pointer, "?"], rt.intTypeLiteral);