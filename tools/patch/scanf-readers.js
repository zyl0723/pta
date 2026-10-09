        const _skip_whitespace = () => {
            const m = input_stream.match(/^[ \t\n\r\v\f]*/);
            input_stream = input_stream.substr(m[0].length);
        };
        const _at_input_eof = () => input_stream.length === 0;
        const _scan_token = (pattern, width) => {
            const limited = width > 0 ? input_stream.substr(0, width) : input_stream;
            const m = limited.match(pattern);
            if (m === null || m[0].length === 0) {
                return null;
            }
            input_stream = input_stream.substr(m[0].length);
            return m[0];
        };
        const _parse_integer_text = (text, base) => {
            if (text === null) {
                return null;
            }
            const negative = text[0] === '-';
            const digits = text.replace(/^[-+]/, '').replace(/^0[xX]/, '');
            const n = parseInt(digits, base);
            if (isNaN(n)) {
                return null;
            }
            return negative ? -n : n;
        };