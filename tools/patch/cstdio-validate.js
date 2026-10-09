const validate_format = function (rt, format, ...params) {
    let i = 0;
    const re = /%(?:[-+ #0])?(?:[0-9]+|\*)?(?:\.(?:[0-9]+|\*))?(hh|h|ll|l|L|z|j|t)?([diuoxXfFeEgGaAcspn])/g;
    let ctrl;
    const result = [];
    while ((ctrl = re.exec(format)) != null) {
        const type = format_type_map(rt, ctrl[2], ctrl[1]);
        if (params.length <= i) {
            rt.raiseException("printf 的格式串里有 " + (i + 1) + " 个占位符，但只提供了 " + params.length + " 个参数");
        }
        const target = params[i++];
        if (type == null) {
            result.push(target && typeof target === "object" && "v" in target ? target.v : target);
            continue;
        }
        const casted = rt.cast(type, target);
        if (rt.isStringType(casted)) {
            result.push(rt.getStringFromCharArray(casted));
        }
        else {
            if (casted.v == null || (typeof (casted.v) === "number" && isNaN(casted.v))) {
                rt.raiseException("printf 用到的一个变量还没有赋值");
            }
            result.push(casted.v);
        }
    }
    return result;
};